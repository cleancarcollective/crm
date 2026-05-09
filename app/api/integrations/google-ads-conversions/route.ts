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
    const result = await exportRecentBookingsForGoogleAds();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[google-ads-conversions] export failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
