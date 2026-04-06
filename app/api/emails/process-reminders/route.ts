import { NextResponse } from "next/server";

import { processScheduledReminderJobs } from "@/lib/email/scheduledReminderJobs";

function isAuthorized(request: Request) {
  const vercelCron = request.headers.get("x-vercel-cron");
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (vercelCron === "1") {
    return true;
  }

  if (!cronSecret) {
    throw new Error("Missing required environment variable: CRON_SECRET");
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized cron request."
      },
      { status: 401 }
    );
  }

  const results = await processScheduledReminderJobs();

  return NextResponse.json({
    success: true,
    processed: results.length,
    results
  });
}
