/**
 * System health page — surfaces silent failures across crons, queues,
 * webhooks, and external integrations.
 *
 * Server-rendered, no cache. Refresh the page for fresh data.
 *
 * Each check returns one of:
 *   - ok        → green
 *   - warn      → amber (degraded but not broken)
 *   - error     → red (immediate attention)
 *   - info      → grey (just an FYI)
 *
 * Keep adding checks here as new pieces of the system come online.
 */

import Link from "next/link";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const DEFAULT_SHOP_SLUG = "christchurch";

type CheckStatus = "ok" | "warn" | "error" | "info";

type Check = {
  name: string;
  status: CheckStatus;
  message: string;
  details?: string;
  category: "Crons & queues" | "Webhooks" | "Auto-respond" | "Email & SMS" | "Data integrity";
};

async function runChecks(shopId: string): Promise<Check[]> {
  const supabase = getSupabaseAdminClient();
  const checks: Check[] = [];
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // ── Crons & queues ──────────────────────────────────────────────────────

  // Stuck pending email jobs > 1 hour past scheduled
  {
    const { data, error } = await supabase
      .from("scheduled_email_jobs")
      .select("id, template_key, scheduled_for")
      .eq("status", "pending")
      .lt("scheduled_for", oneHourAgo)
      .limit(20);
    if (error) {
      checks.push({
        category: "Crons & queues",
        name: "Email job queue",
        status: "error",
        message: "Query failed",
        details: error.message,
      });
    } else {
      const stuck = data ?? [];
      checks.push({
        category: "Crons & queues",
        name: "Email job queue",
        status: stuck.length === 0 ? "ok" : "error",
        message:
          stuck.length === 0
            ? "No stuck jobs"
            : `${stuck.length} job${stuck.length > 1 ? "s" : ""} > 1h overdue — pg_cron may be down`,
        details:
          stuck.length > 0
            ? stuck.slice(0, 3).map((j) => `${j.template_key} @ ${j.scheduled_for}`).join("\n")
            : undefined,
      });
    }
  }

  // Stuck pending SMS jobs > 1 hour past scheduled
  {
    const { data, error } = await supabase
      .from("scheduled_sms_jobs")
      .select("id, message, scheduled_for")
      .eq("status", "pending")
      .lt("scheduled_for", oneHourAgo)
      .limit(20);
    if (error) {
      checks.push({
        category: "Crons & queues",
        name: "SMS job queue",
        status: "error",
        message: "Query failed",
        details: error.message,
      });
    } else {
      const stuck = data ?? [];
      checks.push({
        category: "Crons & queues",
        name: "SMS job queue",
        status: stuck.length === 0 ? "ok" : "error",
        message:
          stuck.length === 0
            ? "No stuck jobs"
            : `${stuck.length} SMS job${stuck.length > 1 ? "s" : ""} > 1h overdue`,
        details:
          stuck.length > 0
            ? stuck.slice(0, 3).map((j) => (j.message as string).slice(0, 60) + "…").join("\n")
            : undefined,
      });
    }
  }

  // Most recent processed job — confirms cron is alive
  {
    const { data: lastEmail } = await supabase
      .from("scheduled_email_jobs")
      .select("updated_at")
      .eq("status", "sent")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastEmail) {
      checks.push({
        category: "Crons & queues",
        name: "Email cron heartbeat",
        status: "warn",
        message: "No jobs ever sent — system may be new",
      });
    } else {
      const ageHours = (now.getTime() - new Date(lastEmail.updated_at).getTime()) / (60 * 60 * 1000);
      checks.push({
        category: "Crons & queues",
        name: "Email cron heartbeat",
        status: ageHours < 26 ? "ok" : "warn",
        message: `Last successful job: ${ageHours.toFixed(1)}h ago`,
        details: lastEmail.updated_at,
      });
    }
  }

  // Failed jobs in the last 7 days
  {
    const { data } = await supabase
      .from("scheduled_email_jobs")
      .select("template_key, last_error, attempt_count")
      .eq("status", "failed")
      .gte("updated_at", sevenDaysAgo)
      .limit(10);
    const failed = data ?? [];
    checks.push({
      category: "Crons & queues",
      name: "Failed jobs (7 days)",
      status: failed.length === 0 ? "ok" : "warn",
      message:
        failed.length === 0
          ? "No failed jobs"
          : `${failed.length} failed (${failed[0]?.last_error ?? "unknown"})`,
    });
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  // Postmark webhook — most recent event
  {
    const { data } = await supabase
      .from("email_events")
      .select("event_type, event_timestamp")
      .order("event_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) {
      checks.push({
        category: "Webhooks",
        name: "Postmark webhook",
        status: "warn",
        message: "No events ever recorded",
      });
    } else {
      const ageHours = (now.getTime() - new Date(data.event_timestamp).getTime()) / (60 * 60 * 1000);
      checks.push({
        category: "Webhooks",
        name: "Postmark webhook",
        status: ageHours < 48 ? "ok" : "warn",
        message: `Last event: ${ageHours.toFixed(1)}h ago (${data.event_type})`,
      });
    }
  }

  // Lead intake webhook — leads created last 24h
  {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .gte("created_at", oneDayAgo);
    checks.push({
      category: "Webhooks",
      name: "Lead intake (24h)",
      status: "info",
      message: `${count ?? 0} leads received`,
    });
  }

  // Booking intake webhook — bookings created last 24h
  {
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .gte("created_at", oneDayAgo);
    checks.push({
      category: "Webhooks",
      name: "Booking intake (24h)",
      status: "info",
      message: `${count ?? 0} bookings created`,
    });
  }

  // ── Auto-respond ────────────────────────────────────────────────────────

  // Auto-respond setting
  {
    const { data } = await supabase
      .from("shop_settings")
      .select("auto_respond_enabled")
      .eq("shop_id", shopId)
      .maybeSingle();
    checks.push({
      category: "Auto-respond",
      name: "Auto-respond enabled",
      status: data?.auto_respond_enabled ? "ok" : "warn",
      message: data?.auto_respond_enabled ? "ON" : "OFF — leads will sit at 'new' until manually actioned",
    });
  }

  // Leads stuck in 'scheduled' > 10 minutes — auto-estimate not firing
  {
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("leads")
      .select("id, updated_at, internal_notes")
      .eq("shop_id", shopId)
      .eq("status", "scheduled")
      .lt("updated_at", tenMinAgo)
      .limit(10);
    const stuck = data ?? [];
    checks.push({
      category: "Auto-respond",
      name: "Leads stuck in 'scheduled'",
      status: stuck.length === 0 ? "ok" : "error",
      message:
        stuck.length === 0
          ? "None"
          : `${stuck.length} lead${stuck.length > 1 ? "s" : ""} stuck — auto-estimate didn't fire`,
    });
  }

  // Recent leads' template_id coverage (auto-respond running properly)
  {
    const { data } = await supabase
      .from("leads")
      .select("template_id, status")
      .eq("shop_id", shopId)
      .gte("created_at", sevenDaysAgo);
    const leads = data ?? [];
    const withTemplate = leads.filter((l) => l.template_id != null).length;
    const pct = leads.length > 0 ? Math.round((withTemplate / leads.length) * 100) : 100;
    checks.push({
      category: "Auto-respond",
      name: "Template coverage (7d)",
      status: leads.length === 0 ? "info" : pct >= 80 ? "ok" : "warn",
      message:
        leads.length === 0
          ? "No leads to assess"
          : `${withTemplate} of ${leads.length} leads have a template (${pct}%)`,
    });
  }

  // ── Email & SMS ─────────────────────────────────────────────────────────

  // Email send success rate (last 7d)
  {
    const { data } = await supabase
      .from("email_messages")
      .select("status")
      .eq("shop_id", shopId)
      .gte("created_at", sevenDaysAgo);
    const msgs = data ?? [];
    const sent = msgs.filter((m) => m.status === "sent").length;
    const failed = msgs.filter((m) => m.status === "failed").length;
    const pct = msgs.length > 0 ? Math.round((sent / msgs.length) * 100) : 100;
    checks.push({
      category: "Email & SMS",
      name: "Email send rate (7d)",
      status: msgs.length === 0 ? "info" : pct >= 95 ? "ok" : pct >= 80 ? "warn" : "error",
      message: `${sent} sent / ${failed} failed${msgs.length > 0 ? ` (${pct}%)` : ""}`,
    });
  }

  // Bounced leads (anyone marked as bounced)
  {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .not("email_bounced_at", "is", null)
      .gte("email_bounced_at", sevenDaysAgo);
    checks.push({
      category: "Email & SMS",
      name: "Bounces (7d)",
      status: (count ?? 0) > 5 ? "warn" : "ok",
      message: `${count ?? 0} bounced/spam-flagged`,
    });
  }

  // ── Data integrity ──────────────────────────────────────────────────────

  // Templates seeded
  {
    const { count } = await supabase
      .from("lead_email_templates")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("is_active", true);
    checks.push({
      category: "Data integrity",
      name: "Active templates",
      status: (count ?? 0) >= 6 ? "ok" : "warn",
      message: `${count ?? 0} active templates (expected ≥6)`,
    });
  }

  // Pricing seeded
  {
    const { count } = await supabase
      .from("pricing")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId);
    checks.push({
      category: "Data integrity",
      name: "Pricing rows",
      status: (count ?? 0) >= 20 ? "ok" : "warn",
      message: `${count ?? 0} pricing rows`,
    });
  }

  // Bookings missing phone (won't get T-1 SMS)
  {
    const { data } = await supabase
      .from("bookings")
      .select("contact:contacts(phone)")
      .eq("shop_id", shopId)
      .gte("scheduled_start", now.toISOString())
      .gte("created_at", sevenDaysAgo);
    const noPhone = (data ?? []).filter(
      (b) => !((b.contact as unknown as { phone: string | null } | null)?.phone)
    ).length;
    checks.push({
      category: "Data integrity",
      name: "Future bookings missing phone",
      status: noPhone === 0 ? "ok" : "warn",
      message:
        noPhone === 0
          ? "All future bookings have a phone number"
          : `${noPhone} won't receive T-1 SMS reminder`,
    });
  }

  return checks;
}

export default async function HealthPage() {
  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id, name")
    .eq("slug", DEFAULT_SHOP_SLUG)
    .maybeSingle();

  if (!shop) return <main className="pageShell"><p>Shop not found.</p></main>;

  const checks = await runChecks(shop.id);

  // Group by category
  const byCategory = new Map<string, Check[]>();
  for (const c of checks) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category)!.push(c);
  }

  const errors = checks.filter((c) => c.status === "error");
  const warns = checks.filter((c) => c.status === "warn");
  const ok = checks.filter((c) => c.status === "ok");

  const overall: CheckStatus =
    errors.length > 0 ? "error" : warns.length > 0 ? "warn" : "ok";

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">
            <Link href="/settings" className="eyebrowLink">← Back to Settings</Link>
          </p>
          <h1 className="pageTitle">System health</h1>
          <p className="detailSubtitle">
            {shop.name} · refreshed {new Date().toISOString().slice(0, 19)}Z
          </p>
        </div>
      </div>

      <section className="detailPanel settingsSection">
        <div className={`healthOverall healthOverall--${overall}`}>
          <div className="healthOverallLabel">
            {overall === "ok" && "All systems operational"}
            {overall === "warn" && "Degraded — investigate warnings"}
            {overall === "error" && "Critical issues detected"}
          </div>
          <div className="healthOverallCounts">
            <span className="healthCountChip healthCount--ok">{ok.length} OK</span>
            <span className="healthCountChip healthCount--warn">{warns.length} warn</span>
            <span className="healthCountChip healthCount--error">{errors.length} error</span>
          </div>
        </div>
      </section>

      {Array.from(byCategory.entries()).map(([category, items]) => (
        <section key={category} className="detailPanel settingsSection">
          <h2>{category}</h2>
          <div className="healthChecks">
            {items.map((c) => (
              <div key={c.name} className={`healthCheckRow healthCheckRow--${c.status}`}>
                <div className="healthCheckLight" data-status={c.status} />
                <div className="healthCheckBody">
                  <div className="healthCheckName">{c.name}</div>
                  <div className="healthCheckMessage">{c.message}</div>
                  {c.details ? (
                    <pre className="healthCheckDetails">{c.details}</pre>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <p className="analyticsFooterHint">
        Refresh this page to re-run all checks. Add new checks in{" "}
        <code>app/settings/health/page.tsx</code> as new system components come online.
      </p>
    </main>
  );
}
