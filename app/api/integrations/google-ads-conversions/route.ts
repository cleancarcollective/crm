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
  const result = await exportRecentBookingsForGoogleAds();
  return NextResponse.json(result);
}
