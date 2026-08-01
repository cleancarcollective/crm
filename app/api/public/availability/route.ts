/**
 * Public booking availability proxy.
 *
 * Each shop has its own Google Apps Script that reads the shop's calendar
 * and returns busy blocks. Calling Apps Script directly from the booking-form
 * iframe means each customer pays the cold-start cost (~500ms), and 14
 * customers in a row each pay it independently.
 *
 * This endpoint:
 *   1. Looks up the shop's Apps Script URL from per-shop env vars
 *   2. Fetches busy blocks for the requested date range — in parallel,
 *      one Apps Script call per date (matches what Apps Script supports
 *      today; can be upgraded to a single bulk call later)
 *   3. Caches the result for 60 seconds at the edge so concurrent / repeat
 *      callers get an instant response
 *
 * Customer-facing endpoint — public, CORS-enabled, no auth.
 */

import { NextResponse } from "next/server";

// Per-shop Apps Script URLs. Each script reads its shop's Google Calendar
// and returns { busy: [{start, end, allDay?}] } for a single date param.
const APPS_SCRIPT_BY_SHOP: Record<string, string> = {
  christchurch:
    process.env.AVAILABILITY_APPS_SCRIPT_CHRISTCHURCH ||
    "https://script.google.com/macros/s/AKfycbwP4txGXMGlAPohOdS0S6hRJIXFa8Xqby07bBvsYyONc0FGcBCTYIzwVgr1wrtFuWY/exec",
  wellington:
    process.env.AVAILABILITY_APPS_SCRIPT_WELLINGTON ||
    "https://script.google.com/macros/s/AKfycbwNVya1aU64eclbO4kNDOAy789NQNOOLu-_TPrDfskBwjO7hwxVj2YeNLdqE4Extfz6Kw/exec",
};

const MAX_DAYS = 21; // safety cap so a malicious caller can't request 365 days

type BusyBlock = { start: string; end: string; allDay?: boolean };

function withCors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  // Edge cache: 60s fresh, 600s stale-while-revalidate. Anyone hitting the
  // same shop/location/days combo within 60s gets the cached response;
  // between 60-600s gets the cached response while we revalidate behind it.
  response.headers.set(
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=600"
  );
  return response;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const shopSlug = searchParams.get("shop");
  const locationType = searchParams.get("type") || "shop"; // "shop" | "mobile"
  const days = Math.min(Number(searchParams.get("days") || "14"), MAX_DAYS);
  const startDate = searchParams.get("start"); // YYYY-MM-DD; defaults to today

  if (!shopSlug || !APPS_SCRIPT_BY_SHOP[shopSlug]) {
    return withCors(
      NextResponse.json(
        { error: "Unknown or missing shop slug." },
        { status: 400 }
      )
    );
  }

  const scriptUrl = APPS_SCRIPT_BY_SHOP[shopSlug];

  // Compute the date list. We use NZ-local "today" as the anchor so the
  // server's UTC offset doesn't shift the window.
  const todayStr =
    startDate ??
    new Date()
      .toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }); // YYYY-MM-DD
  const startMs = new Date(`${todayStr}T00:00:00Z`).getTime();

  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startMs + i * 24 * 60 * 60 * 1000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    dates.push(`${yyyy}-${mm}-${dd}`);
  }

  // Fetch all dates in parallel. Apps Script handles concurrent requests
  // fine for read-only calendar queries.
  const settled = await Promise.allSettled(
    dates.map(async (date) => {
      const params = new URLSearchParams({ type: locationType, date });
      // Hard timeout per date. A healthy Apps Script answers in ~1-2s; a
      // stale/misconfigured deployment can hang for 30s+ behind an auth
      // redirect chain (Christchurch, 1 Aug 2026) which froze the whole
      // booking flow on "Finding slots". Cap it: a timed-out date falls
      // through to "no busy blocks" (all slots open) — a slow calendar
      // must never block a booking.
      const res = await fetch(`${scriptUrl}?${params.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        throw new Error(`Apps Script ${res.status} for ${date}`);
      }
      const json = (await res.json()) as { busy?: BusyBlock[]; error?: string };
      if (json.error) throw new Error(`Apps Script error for ${date}: ${json.error}`);
      return { date, busy: json.busy ?? [] };
    })
  );

  // Build response — preserve order, return what we got. Failed dates get
  // an empty array (frontend will treat them as "all slots open" — better
  // to over-show than under-show).
  const busyByDate: Record<string, BusyBlock[]> = {};
  const errors: Array<{ date: string; error: string }> = [];
  settled.forEach((s, i) => {
    const date = dates[i]!;
    if (s.status === "fulfilled") {
      // Google all-day events use an EXCLUSIVE end (00:00 of the next day), and
      // the upstream script reported each all-day block as busy on BOTH its own
      // date and the following one — so blocking a day silently killed the next
      // day too (and showed a doubled "Blocked via CRM" bar). Keep an all-day
      // block only if it spans this date's local noon, a safe interior point
      // well away from the midnight boundary (DST-tolerant).
      const noon = new Date(`${date}T12:00:00+12:00`).getTime();
      busyByDate[date] = s.value.busy.filter((b) => {
        if (!b.allDay) return true;
        const bs = b.start ? new Date(b.start).getTime() : -Infinity;
        const be = b.end ? new Date(b.end).getTime() : Infinity;
        return bs <= noon && noon < be;
      });
    } else {
      busyByDate[date] = [];
      errors.push({ date, error: s.reason?.message ?? "unknown" });
    }
  });

  return withCors(
    NextResponse.json({
      shop: shopSlug,
      type: locationType,
      busyByDate,
      ...(errors.length > 0 ? { errors } : {}),
    })
  );
}
