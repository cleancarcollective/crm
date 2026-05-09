import { NextResponse } from "next/server";

import { sendPendingEnquiriesReportForAllShops } from "@/lib/email/sendPendingEnquiriesReport";

/**
 * On-demand "what's sitting in the queue?" email — fires the report to each
 * shop's team_email. Authed via CRON_SECRET so it can be triggered manually
 * from a curl/browser without exposing it publicly.
 */
function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("Missing CRON_SECRET");
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const result = await sendPendingEnquiriesReportForAllShops();
  return NextResponse.json(result);
}
