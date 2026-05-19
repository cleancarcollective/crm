import { NextResponse } from "next/server";

import { exportRecentBookingsForGoogleAds } from "@/lib/integrations/googleAdsConversionExport";

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
    // Optional ?days=N widens the export window beyond the default 24h.
    // Used for one-off backfills (e.g. after fixing a routing bug).
    // Apps Scripts on the Sheets side dedupe by booking_id so resending
    // is idempotent. Capped at 90 days to avoid catastrophic accidents.
    const url = new URL(request.url);
    const daysParam = url.searchParams.get("days");
    const days = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 1, 1), 90) : 1;

    const result = await exportRecentBookingsForGoogleAds({ windowDays: days });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[google-ads-conversions] export failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
