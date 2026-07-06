import { NextResponse } from "next/server";

import { uploadRecentBookingsToMeta } from "@/lib/integrations/metaCapi";

function isAuthorized(request: Request) {
  const vercelCron = request.headers.get("x-vercel-cron");
  if (vercelCron === "1") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("Missing CRON_SECRET");
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  try {
    // Optional ?days=N widens the window for one-off backfills (default 2:
    // overlapping windows are safe because event_id = booking id dedupes on
    // Meta's side). Optional ?test_event_code=X routes the batch to the
    // Events Manager Test Events tab instead of production data.
    const url = new URL(request.url);
    const daysParam = url.searchParams.get("days");
    const days = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 2, 1), 90) : 2;
    const testEventCode = url.searchParams.get("test_event_code");

    const result = await uploadRecentBookingsToMeta({ windowDays: days, testEventCode });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[meta-capi] upload failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
