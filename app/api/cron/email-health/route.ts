/**
 * GET /api/cron/email-health
 *
 * Recent-window email deliverability guard. Hit frequently by an EXTERNAL
 * scheduler (GitHub Actions, every ~30 min) so a transport outage — e.g. an
 * expired Gmail SMTP app password — is caught in minutes, not the 5 days it
 * took in Aug 2026 when Wellington email silently failed ~60% of sends.
 *
 * Returns 200 when healthy, 503 when any shop's recent send-failure rate
 * crosses the threshold. The caller fails loudly on a non-200 and notifies
 * the owner via a channel (GitHub notifications) that does NOT depend on the
 * CRM's own — possibly broken — email. This is deliberately transport-
 * independent: the whole point is to catch the case where email is down.
 *
 * Auth: same dual-mode as the other crons (x-vercel-cron or Bearer
 * CRON_SECRET). Read-only.
 */

import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function isAuthorized(request: Request) {
  const vercelCron = request.headers.get("x-vercel-cron");
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (vercelCron === "1") return true;
  if (!cronSecret) throw new Error("Missing required environment variable: CRON_SECRET");
  return authHeader === `Bearer ${cronSecret}`;
}

const WINDOW_MS = 3 * 60 * 60 * 1000; // look back 3 hours
const MIN_ATTEMPTS = 6; // ignore low-volume noise
const MAX_FAIL_PCT = 40; // >40% of attempted sends failing in-window = unhealthy

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const { data: shops } = await supabase.from("shops").select("id, slug");

  const report: Array<{
    shop: string;
    sent: number;
    failed: number;
    failPct: number;
    unhealthy: boolean;
  }> = [];

  for (const shop of shops ?? []) {
    const { data } = await supabase
      .from("email_messages")
      .select("status")
      .eq("shop_id", shop.id)
      .gte("created_at", since);
    const msgs = data ?? [];
    const sent = msgs.filter((m) => m.status === "sent").length;
    const failed = msgs.filter((m) => m.status === "failed").length;
    const attempted = sent + failed;
    const failPct = attempted > 0 ? Math.round((failed / attempted) * 100) : 0;
    const unhealthy = attempted >= MIN_ATTEMPTS && failPct > MAX_FAIL_PCT;
    report.push({ shop: shop.slug, sent, failed, failPct, unhealthy });
  }

  const bad = report.filter((r) => r.unhealthy);
  if (bad.length > 0) {
    const alert = bad
      .map((b) => `${b.shop}: ${b.failPct}% failing (${b.failed} failed / ${b.sent} sent, last 3h)`)
      .join("; ");
    return NextResponse.json(
      {
        ok: false,
        alert: `EMAIL DELIVERABILITY ALERT — ${alert}. Check the Gmail SMTP app passwords (GMAIL_APP_PASSWORD_WELLINGTON / _CHRISTCHURCH) and Vercel env.`,
        report,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true, windowHours: WINDOW_MS / 3600000, report });
}
