/**
 * Live funnel + attribution dashboard.
 *
 * Pulls counts directly from Supabase on every request (server-rendered),
 * so the numbers always reflect current state. No caching.
 *
 * Stages are defined in code (see LEAD_STAGES / BOOKING_STAGES below) —
 * keep those in sync with the actual lifecycle. When you add a new stage
 * (e.g. lead_followup_30day, lead_clicked_quote, etc.), update the
 * stages list and the funnel page renders it automatically.
 */

import Link from "next/link";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const DEFAULT_SHOP_SLUG = "christchurch";
const WINDOW_DAYS = 30;

type Stage = {
  label: string;
  description: string;
  /** Returns the number of items reaching this stage out of `total` input rows */
  matches: (row: AnyRow) => boolean;
};

type AnyRow = Record<string, unknown>;

// ── Lead funnel ────────────────────────────────────────────────────────────
// Reads the leads table. "Reaches stage X" means the lead hit that milestone,
// regardless of current status (e.g. a lead with status='won' reached 'sent'
// earlier). That's why each stage's predicate is inclusive of later stages.

const LEAD_STAGES: Stage[] = [
  {
    label: "Lead received",
    description: "Lead form submitted",
    matches: () => true, // every row counts
  },
  {
    label: "Queued for auto-send",
    description: "Passed auto-respond gate, 3-min delay scheduled",
    matches: (r) =>
      isDownstreamOf(r.status as string, "scheduled") ||
      r.status === "scheduled" ||
      hasTemplateId(r),
  },
  {
    label: "Estimate sent",
    description: "Auto-respond email delivered to customer",
    matches: (r) =>
      ["sent", "clicked", "won", "lost"].includes(r.status as string) ||
      Boolean(r.email_delivered_at),
  },
  {
    label: "Engaged (opened or clicked)",
    description: "Customer opened or clicked the estimate",
    matches: (r) => Boolean(r.email_opened_at) || Boolean(r.email_clicked_at),
  },
  {
    label: "Needed approval",
    description: "Held for human review (escalation path)",
    matches: (r) =>
      r.status === "needs_approval" ||
      (typeof r.internal_notes === "string" && r.internal_notes.includes("Needs approval:")),
  },
  {
    label: "Won (converted to booking)",
    description: "Customer booked a service",
    matches: (r) => r.status === "won",
  },
  {
    label: "Lost",
    description: "Manually marked as lost",
    matches: (r) => r.status === "lost",
  },
];

// Cheap ordering helper so we know 'won' is "downstream" of 'sent' etc.
const STATUS_ORDER = [
  "new",
  "needs_approval",
  "scheduled",
  "sent",
  "clicked",
  "won",
  "lost",
];
function isDownstreamOf(status: string | undefined, threshold: string): boolean {
  if (!status) return false;
  const si = STATUS_ORDER.indexOf(status);
  const ti = STATUS_ORDER.indexOf(threshold);
  return si >= 0 && ti >= 0 && si > ti;
}
function hasTemplateId(r: AnyRow): boolean {
  return r.template_id !== null && r.template_id !== undefined;
}

// ── Booking funnel ─────────────────────────────────────────────────────────

const BOOKING_STAGES: Stage[] = [
  {
    label: "Booking created",
    description: "Customer booked (via web or manually entered)",
    matches: () => true,
  },
  {
    label: "Confirmed",
    description: "Booking currently confirmed",
    matches: (r) =>
      ["pending", "confirmed", "completed"].includes(r.status as string),
  },
  {
    label: "Completed",
    description: "Service delivered (pickup button clicked)",
    matches: (r) => r.status === "completed",
  },
  {
    label: "No-show / cancelled",
    description: "Customer didn't show up or cancelled",
    matches: (r) =>
      r.status === "no_show" || r.status === "cancelled" || r.status === "no-show",
  },
];

// ── Data fetchers ──────────────────────────────────────────────────────────

async function loadLeadFunnel(shopId: string) {
  const supabase = getSupabaseAdminClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, status, template_id, email_opened_at, email_clicked_at, email_delivered_at, internal_notes, created_at, won_source"
    )
    .eq("shop_id", shopId)
    .gte("created_at", since);

  if (error) throw error;
  return (data ?? []) as AnyRow[];
}

async function loadBookingFunnel(shopId: string) {
  const supabase = getSupabaseAdminClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("bookings")
    .select("id, status, booking_source, created_at, scheduled_start")
    .eq("shop_id", shopId)
    .gte("created_at", since);

  if (error) throw error;
  return (data ?? []) as AnyRow[];
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function AnalyticsPage() {
  const supabase = getSupabaseAdminClient();

  const { data: shop } = await supabase
    .from("shops")
    .select("id, name")
    .eq("slug", DEFAULT_SHOP_SLUG)
    .maybeSingle();

  if (!shop) return <main className="pageShell"><p>Shop not found.</p></main>;

  const [leads, bookings] = await Promise.all([
    loadLeadFunnel(shop.id),
    loadBookingFunnel(shop.id),
  ]);

  const leadStageCounts = LEAD_STAGES.map((stage) => ({
    ...stage,
    count: leads.filter(stage.matches).length,
  }));

  const bookingStageCounts = BOOKING_STAGES.map((stage) => ({
    ...stage,
    count: bookings.filter(stage.matches).length,
  }));

  // Won-source breakdown
  const wonLeads = leads.filter((l) => l.status === "won");
  const sourceCounts = new Map<string, number>();
  for (const l of wonLeads) {
    const s = (l.won_source as string) ?? "unknown";
    sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1);
  }

  // Revenue proxy — sum price_estimate on in-window confirmed/completed bookings
  const bookingRevenueEligible = bookings.filter((b) =>
    ["confirmed", "completed"].includes(b.status as string)
  );

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Clean Car Collective CRM</p>
          <h1 className="pageTitle">Funnel</h1>
          <p className="detailSubtitle">
            {shop.name} · last {WINDOW_DAYS} days
          </p>
        </div>
      </div>

      <section className="detailPanel analyticsSection">
        <h2>Lead funnel</h2>
        <p className="settingsDescription">
          Every stage a lead reaches, from inbound form submission to conversion.
          Stages are cumulative — a lead that converted to a booking still counts
          as having reached every earlier stage.
        </p>
        <FunnelVisual stages={leadStageCounts} />
      </section>

      <section className="detailPanel analyticsSection">
        <h2>Booking funnel</h2>
        <p className="settingsDescription">
          Bookings created in the last {WINDOW_DAYS} days and their lifecycle.
        </p>
        <FunnelVisual stages={bookingStageCounts} />
      </section>

      <section className="detailPanel analyticsSection">
        <h2>Conversion sources</h2>
        <p className="settingsDescription">
          How won leads got here. <code>auto_email</code> = customer received an
          auto-respond estimate and then booked. <code>direct_booking</code> = booked
          without an estimate email (e.g. phoned in).
        </p>
        {sourceCounts.size === 0 ? (
          <p style={{ color: "var(--muted)" }}>No wins in this window yet.</p>
        ) : (
          <div className="sourceBreakdown">
            {Array.from(sourceCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([source, count]) => (
                <div key={source} className="sourceRow">
                  <span className="sourceLabel">{source}</span>
                  <span className="sourceCount">{count}</span>
                </div>
              ))}
          </div>
        )}
      </section>

      <section className="detailPanel analyticsSection">
        <h2>Quick facts</h2>
        <div className="quickFactsGrid">
          <Fact label="Leads" value={leads.length} />
          <Fact
            label="Leads → won"
            value={`${leadStageCounts.find((s) => s.label.startsWith("Won"))?.count ?? 0} (${pct(
              leadStageCounts.find((s) => s.label.startsWith("Won"))?.count ?? 0,
              leads.length
            )})`}
          />
          <Fact label="Bookings" value={bookings.length} />
          <Fact label="Confirmed" value={bookingRevenueEligible.length} />
        </div>
      </section>

      <p className="analyticsFooterHint">
        Want a different window, per-template breakdown, or revenue attribution?{" "}
        <Link href="/settings/templates">Per-template performance is on the templates page.</Link>
      </p>
    </main>
  );
}

// ── Small components ──────────────────────────────────────────────────────

function FunnelVisual({ stages }: { stages: (Stage & { count: number })[] }) {
  const maxCount = Math.max(1, ...stages.map((s) => s.count));
  const entryCount = stages[0]?.count ?? 0;

  return (
    <div className="funnelList">
      {stages.map((s, i) => {
        const width = (s.count / maxCount) * 100;
        const pctOfEntry = entryCount > 0 ? Math.round((s.count / entryCount) * 100) : 0;

        return (
          <div key={s.label} className="funnelRow">
            <div className="funnelRowLabel">
              <div className="funnelStageName">
                <span className="funnelStageIndex">{i + 1}</span>
                {s.label}
              </div>
              <div className="funnelStageDesc">{s.description}</div>
            </div>
            <div className="funnelRowBarWrap">
              <div className="funnelRowBar" style={{ width: `${width}%` }}>
                <span className="funnelRowBarValue">{s.count}</span>
              </div>
            </div>
            <div className="funnelRowPct">{pctOfEntry}%</div>
          </div>
        );
      })}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="quickFactCard">
      <div className="quickFactValue">{value}</div>
      <div className="quickFactLabel">{label}</div>
    </div>
  );
}

function pct(num: number, den: number): string {
  if (!den) return "0%";
  return `${Math.round((num / den) * 100)}%`;
}
