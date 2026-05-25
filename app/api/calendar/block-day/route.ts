/**
 * POST /api/calendar/block-day
 *
 * Lets any signed-in staff member block a day (or a time range within a day)
 * on the shop's Google Calendar. The block is created via the per-shop
 * Apps Script web app — same script that already serves availability reads,
 * just with a new doPost handler that creates a calendar event.
 *
 * Body:
 *   {
 *     day: "yyyy-MM-dd",
 *     scope: "all_day" | "time_range",
 *     start_time?: "HH:mm",     // required when scope=time_range
 *     end_time?: "HH:mm",       // required when scope=time_range
 *     reason?: string,          // optional, surfaced in event title
 *     action?: "block" | "unblock"   // default "block"
 *   }
 *
 * Auth: requires a signed-in user via requireCurrentShop. The shop_slug is
 * derived from the user's session — staff can only block their own shop.
 */

import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";

// Same per-shop scripts that handle availability reads. Each script's doPost
// uses CalendarApp.createEvent / createAllDayEvent on its bound calendar.
// Apps Script URLs match the availability route — kept in env vars with
// a hardcoded fallback for resilience.
// Hardcoded to the deployments that include the doPost (block) handler.
// These same URLs serve the doGet availability read too, so the public
// availability route uses them via env var. Env var still wins so a swap
// here can be done at runtime without redeploy.
const APPS_SCRIPT_BY_SHOP: Record<string, string> = {
  christchurch:
    process.env.AVAILABILITY_APPS_SCRIPT_CHRISTCHURCH ||
    "https://script.google.com/macros/s/AKfycbwP4txGXMGlAPohOdS0S6hRJIXFa8Xqby07bBvsYyONc0FGcBCTYIzwVgr1wrtFuWY/exec",
  wellington:
    process.env.AVAILABILITY_APPS_SCRIPT_WELLINGTON ||
    "https://script.google.com/macros/s/AKfycbwNVya1aU64eclbO4kNDOAy789NQNOOLu-_TPrDfskBwjO7hwxVj2YeNLdqE4Extfz6Kw/exec",
};

type Body = {
  day?: string;
  scope?: "all_day" | "time_range";
  start_time?: string;
  end_time?: string;
  reason?: string | null;
  action?: "block" | "unblock";
};

const HHMM = /^\d{2}:\d{2}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action ?? "block";
  if (action !== "block" && action !== "unblock") {
    return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
  }
  if (!body.day || !YMD.test(body.day)) {
    return NextResponse.json({ ok: false, error: "Invalid day (expect yyyy-MM-dd)" }, { status: 400 });
  }
  const scope = body.scope ?? "all_day";
  if (scope !== "all_day" && scope !== "time_range") {
    return NextResponse.json({ ok: false, error: "Invalid scope" }, { status: 400 });
  }
  if (scope === "time_range") {
    if (!body.start_time || !HHMM.test(body.start_time) || !body.end_time || !HHMM.test(body.end_time)) {
      return NextResponse.json({ ok: false, error: "Invalid start/end time" }, { status: 400 });
    }
    if (body.start_time >= body.end_time) {
      return NextResponse.json({ ok: false, error: "End time must be after start time" }, { status: 400 });
    }
  }

  const shop = await requireCurrentShop();
  const scriptUrl = APPS_SCRIPT_BY_SHOP[shop.slug];
  if (!scriptUrl) {
    return NextResponse.json(
      { ok: false, error: `No Apps Script URL configured for shop ${shop.slug}` },
      { status: 500 },
    );
  }
  const secret = process.env.CALENDAR_WRITE_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CALENDAR_WRITE_SECRET not configured" },
      { status: 500 },
    );
  }

  // Apps Script POSTs respond with a 302 to a googleusercontent.com URL.
  // Default fetch redirect-follow handles this correctly.
  const upstream = await fetch(scriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      action,
      date: body.day,
      scope,
      start_time: body.start_time ?? null,
      end_time: body.end_time ?? null,
      reason: body.reason?.trim() || null,
    }),
  });

  const responseText = await upstream.text().catch(() => "");
  if (!upstream.ok) {
    return NextResponse.json(
      { ok: false, error: `Apps Script HTTP ${upstream.status}: ${responseText.slice(0, 300)}` },
      { status: 502 },
    );
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return NextResponse.json(
      { ok: false, error: `Non-JSON from Apps Script: ${responseText.slice(0, 300)}` },
      { status: 502 },
    );
  }
  if (parsed.ok !== true) {
    return NextResponse.json(
      { ok: false, error: parsed.error ?? "Apps Script returned ok=false" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    shop_slug: shop.slug,
    day: body.day,
    scope,
    action,
    upstream: parsed,
  });
}
