/**
 * Collective membership dashboard.
 *
 * Server-rendered from live tables on every request:
 *   - memberships     → signups, paid, click-don't-pay, churn, MRR, by source
 *   - funnel_events   → booking-funnel: saw card → selected → booked
 *   - portal_events   → in-portal: opened → join click → reached Stripe
 *   - credit_ledger   → outstanding credit liability
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const metadata = { title: "Collective - CCC CRM" };

function nzd(cents: number) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 }).format(cents / 100);
}
function pct(n: number, d: number) {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
}

function Fact({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="quickFactCard">
      <div className="quickFactValue">{value}</div>
      <div className="quickFactLabel">{label}</div>
      {hint ? <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{hint}</div> : null}
    </div>
  );
}

function FunnelRow({ label, count, of }: { label: string; count: number; of?: number }) {
  const width = of && of > 0 ? Math.max(4, Math.round((count / of) * 100)) : count > 0 ? 100 : 4;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600 }}>
          {count}
          {of && of > 0 ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · {pct(count, of)}</span> : null}
        </span>
      </div>
      <div style={{ height: 8, background: "var(--panel-soft)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${width}%`, height: "100%", background: "var(--success)" }} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    active: { bg: "#dcfce7", fg: "#166534", label: "Active" },
    pending: { bg: "#fef3c7", fg: "#92400e", label: "Not paid" },
    past_due: { bg: "#fee2e2", fg: "#991b1b", label: "Past due" },
    cancelled: { bg: "#f4f4f5", fg: "#52525b", label: "Cancelled" },
  };
  const v = map[status ?? ""] ?? { bg: "#f4f4f5", fg: "#52525b", label: status ?? "-" };
  return (
    <span style={{ background: v.bg, color: v.fg, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {v.label}
    </span>
  );
}

export default async function CollectivePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login" as never);

  const supabase = getSupabaseAdminClient();
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString();

  const [{ data: memberships }, { data: portalEvents }, { data: funnelEvents }, { data: ledger }, { data: memberRows }] = await Promise.all([
    supabase.from("memberships").select("status, source, monthly_fee_cents, created_at"),
    supabase.from("portal_events").select("event").in("event", ["portal_open", "join_click", "join_start"]),
    supabase.from("funnel_events").select("session_id, step").in("step", ["review", "collective_select", "booked"]).gte("created_at", since90),
    supabase.from("credit_ledger").select("delta_cents"),
    supabase
      .from("memberships")
      .select(
        "id, status, source, size_tier, monthly_fee_cents, monthly_credit_cents, created_at, started_at, cancelled_at, stripe_subscription_id, shop_id, contacts(id, full_name, first_name, last_name, email, phone)"
      )
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const m = memberships ?? [];
  const count = (s: string) => m.filter((x) => x.status === s).length;
  const total = m.length;
  const active = count("active");
  const pending = count("pending");
  const pastDue = count("past_due");
  const cancelled = count("cancelled");
  const mrr = m.filter((x) => x.status === "active").reduce((s, x) => s + (x.monthly_fee_cents || 0), 0);

  // By source
  const sources = Array.from(new Set(m.map((x) => x.source || "unknown")));
  const bySource = sources
    .map((src) => {
      const rows = m.filter((x) => (x.source || "unknown") === src);
      return { src, signups: rows.length, active: rows.filter((x) => x.status === "active").length };
    })
    .sort((a, b) => b.signups - a.signups);

  // In-portal funnel (event counts)
  const pe = (ev: string) => (portalEvents ?? []).filter((x) => x.event === ev).length;

  // Booking funnel (distinct sessions per step)
  const distinctSessions = (step: string) => new Set((funnelEvents ?? []).filter((x) => x.step === step).map((x) => x.session_id)).size;
  const sawCard = distinctSessions("review");
  const selectedCard = distinctSessions("collective_select");
  const bookedSessions = distinctSessions("booked");
  const bookingFormSignups = m.filter((x) => (x.source || "") === "booking-form").length;
  const portalSignups = m.filter((x) => (x.source || "") === "portal").length;

  // Per-member list. "Pending" means they clicked join but never finished
  // Stripe checkout, so those are the rows worth chasing - surfaced first.
  type MemberRow = {
    id: string;
    status: string | null;
    source: string | null;
    size_tier: string | null;
    monthly_fee_cents: number | null;
    monthly_credit_cents: number | null;
    created_at: string;
    stripe_subscription_id: string | null;
    shop_id: string | null;
    contacts: { id: string; full_name: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null;
  };
  const rows = ((memberRows ?? []) as unknown as MemberRow[]).map((r) => {
    const c = r.contacts;
    const name = c?.full_name || [c?.first_name, c?.last_name].filter(Boolean).join(" ") || c?.email || "Unknown";
    const days = Math.floor((Date.now() - Date.parse(r.created_at)) / 86400000);
    return { ...r, name, email: c?.email ?? null, phone: c?.phone ?? null, contactId: c?.id ?? null, days };
  });
  // Only members who actually completed checkout. "pending" means they clicked
  // join but never finished Stripe, so they have no subscription and are not
  // being billed - they're counted in the stats above, not listed here.
  const paidRows = rows.filter((r) => r.status !== "pending");
  const hiddenPending = rows.length - paidRows.length;

  const creditOutstanding = (ledger ?? []).reduce((s, x) => s + (x.delta_cents || 0), 0);

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <h1>The Collective</h1>
          <p className="settingsDescription">Membership signups, conversion, and where people drop off. All-time; booking-funnel steps last 90 days.</p>
        </div>
      </div>

      <section className="detailPanel analyticsSection">
        <h2>Members</h2>
        <div className="quickFactsGrid">
          <Fact label="Total signups" value={total} />
          <Fact label="Paid &amp; active" value={active} hint={pct(active, total) + " of signups"} />
          <Fact label="Clicked, not paid" value={pending} hint="pending checkout" />
          <Fact label="Past due" value={pastDue} />
          <Fact label="Cancelled" value={cancelled} />
          <Fact label="MRR (ex-GST)" value={nzd(mrr)} />
          <Fact label="Credit outstanding" value={nzd(creditOutstanding)} hint="banked, unspent" />
        </div>
      </section>

      <section className="detailPanel analyticsSection">
        <h2>By signup source</h2>
        <p className="settingsDescription">Which channel drives members. booking-form = ticked on the booking review step; portal = joined from /account.</p>
        <div style={{ display: "flex", fontSize: 12, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, paddingBottom: 6 }}>
          <span style={{ flex: 1 }}>Source</span>
          <span style={{ width: 80, textAlign: "right" }}>Signups</span>
          <span style={{ width: 70, textAlign: "right" }}>Active</span>
          <span style={{ width: 70, textAlign: "right" }}>Paid %</span>
        </div>
        {bySource.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No signups yet.</p>
        ) : (
          bySource.map((r) => (
            <div key={r.src} style={{ display: "flex", fontSize: 14, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{r.src}</span>
              <span style={{ width: 80, textAlign: "right" }}>{r.signups}</span>
              <span style={{ width: 70, textAlign: "right" }}>{r.active}</span>
              <span style={{ width: 70, textAlign: "right" }}>{pct(r.active, r.signups)}</span>
            </div>
          ))
        )}
      </section>

      <section className="detailPanel analyticsSection">
        <h2>Booking funnel → Collective</h2>
        <p className="settingsDescription">Of people who reach the review step and see the Collective card. Sessions, last 90 days.</p>
        <FunnelRow label="Saw the card (reached review)" count={sawCard} of={sawCard} />
        <FunnelRow label="Ticked Join the Collective" count={selectedCard} of={sawCard} />
        <FunnelRow label="Completed the booking" count={bookedSessions} of={sawCard} />
        <FunnelRow label="Membership created (booking-form)" count={bookingFormSignups} of={sawCard} />
      </section>

      <section className="detailPanel analyticsSection">
        <h2>In-account funnel → Collective</h2>
        <p className="settingsDescription">People who join from their /account portal.</p>
        <FunnelRow label="Opened their account" count={pe("portal_open")} of={pe("portal_open")} />
        <FunnelRow label="Clicked Join" count={pe("join_click")} of={pe("portal_open")} />
        <FunnelRow label="Reached Stripe checkout" count={pe("join_start")} of={pe("portal_open")} />
        <FunnelRow label="Membership created (portal)" count={portalSignups} of={pe("portal_open")} />
      </section>

      <section className="detailPanel analyticsSection">
        <h2>Member list</h2>
        <p className="settingsDescription">
          Paying members, newest first.{" "}
          {hiddenPending > 0
            ? `${hiddenPending} signup${hiddenPending === 1 ? "" : "s"} not shown: clicked join but never completed payment.`
            : null}
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 780 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
                <th style={{ padding: "6px 8px 6px 0" }}>Member</th>
                <th style={{ padding: "6px 8px" }}>Contact</th>
                <th style={{ padding: "6px 8px" }}>Status</th>
                <th style={{ padding: "6px 8px" }}>Vehicle size</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Fee</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Credit</th>
                <th style={{ padding: "6px 8px" }}>Source</th>
                <th style={{ padding: "6px 8px" }}>Signed up</th>
              </tr>
            </thead>
            <tbody>
              {paidRows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 12, color: "var(--muted)" }}>No paying members yet.</td>
                </tr>
              ) : (
                paidRows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "10px 8px 10px 0", fontWeight: 600 }}>
                      {r.contactId ? <Link href={`/contacts/${r.contactId}`} className="profileNameLink">{r.name}</Link> : r.name}
                    </td>
                    <td style={{ padding: "10px 8px", color: "var(--muted)" }}>
                      {r.email ? <div>{r.email}</div> : null}
                      {r.phone ? <div>{r.phone}</div> : null}
                      {!r.email && !r.phone ? "-" : null}
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <StatusPill status={r.status} />
                      {r.status === "pending" ? (
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{r.days}d waiting</div>
                      ) : null}
                    </td>
                    <td style={{ padding: "10px 8px" }}>{r.size_tier ?? "-"}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right" }}>{nzd(r.monthly_fee_cents ?? 0)}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right", color: "#166534", fontWeight: 600 }}>{nzd(r.monthly_credit_cents ?? 0)}</td>
                    <td style={{ padding: "10px 8px" }}>{r.source ?? "-"}</td>
                    <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }}>{String(r.created_at).slice(0, 10)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}