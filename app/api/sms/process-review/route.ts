import { NextResponse } from "next/server";

import { processScheduledSmsJobs } from "@/lib/sms/scheduledSmsJobs";

function isAuthorized(request: Request) {
  const vercelCron = request.headers.get("x-vercel-cron");
  if (vercelCron === "1") return true;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("Missing CRON_SECRET environment variable");

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  const results = await processScheduledSmsJobs();

  return NextResponse.json({
    success: true,
    processed: results.length,
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}
