import { NextResponse } from "next/server";

import { sendWeeklyConversionReportForAllShops } from "@/lib/email/sendWeeklyConversionReport";

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
  const result = await sendWeeklyConversionReportForAllShops();
  return NextResponse.json(result);
}
