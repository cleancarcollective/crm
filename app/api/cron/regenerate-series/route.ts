/**
 * GET /api/cron/regenerate-series
 *
 * Daily cron. For each active booking_series, tops up occurrences so the
 * calendar stays 12 months ahead. Idempotent — only inserts the sequences
 * that don't already exist. Writes last_regen_at + last_regen_error so the
 * System Health page can surface failures within a day.
 *
 * Auth: same dual-mode as other crons — Vercel cron header passes through,
 * manual runs need Authorization: Bearer ${CRON_SECRET}.
 */

import { NextResponse } from "next/server";

import { regenerateAllActiveSeries } from "@/lib/bookings/series";

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
      { success: false, error: "Unauthorized cron request." },
      { status: 401 },
    );
  }

  try {
    const results = await regenerateAllActiveSeries();
    const ok = results.filter((r) => r.status === "ok").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const created = results.reduce((sum, r) => sum + r.createdCount, 0);

    return NextResponse.json({
      success: failed === 0,
      summary: { total: results.length, ok, skipped, failed, occurrences_created: created },
      results,
    });
  } catch (err) {
    console.error("regenerate-series cron failed", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Cron failed" },
      { status: 500 },
    );
  }
}
