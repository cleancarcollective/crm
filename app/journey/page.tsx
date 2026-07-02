/**
 * /journey — read-only visual map of every automated customer touchpoint
 * (email + SMS) along the journey, with live enabled-state and send stats.
 *
 * Registry lives in lib/journey/touchpoints.ts — add new touchpoints there.
 * Admin-only, current-shop scoped like /analytics.
 */

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/currentShop";
import {
  buildJourneyStages,
  loadJourneyData,
  statKeyToString,
  type Touchpoint,
  type TouchpointStats,
} from "@/lib/journey/touchpoints";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    timeZone: "Pacific/Auckland",
  }).format(new Date(iso));
}

const CHANNEL_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  email: { label: "EMAIL", bg: "#e8f0fe", fg: "#1a4d8f" },
  sms: { label: "SMS", bg: "#e6f4ea", fg: "#1a6d3a" },
};

function TouchpointCard({ tp, stats }: { tp: Touchpoint; stats: TouchpointStats | undefined }) {
  const ch = CHANNEL_STYLE[tp.channel];
  const tracked = statKeyToString(tp.stat) !== null;
  const s = stats;
  return (
    <div
      style={{
        border: "1px solid #e2ddd5",
        borderRadius: 10,
        padding: "12px 14px",
        background: tp.enabled ? "#fff" : "#faf8f5",
        opacity: tp.enabled ? 1 : 0.75,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            padding: "2px 7px",
            borderRadius: 5,
            background: ch.bg,
            color: ch.fg,
          }}
        >
          {ch.label}
        </span>
        <strong style={{ fontSize: 14 }}>{tp.label}</strong>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 9px",
            borderRadius: 999,
            background: tp.enabled ? "#dcf2e3" : "#f4dede",
            color: tp.enabled ? "#176639" : "#9c2b2b",
          }}
        >
          {tp.enabled ? "ON" : "OFF"}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "#6b6257" }}>
        {tp.trigger} · sends {tp.timing}
      </div>
      {tracked ? (
        <div style={{ display: "flex", gap: 14, fontSize: 12, flexWrap: "wrap", color: "#3d382f" }}>
          <span><strong>{s?.sent ?? 0}</strong> sent</span>
          <span><strong>{s?.sentLast30 ?? 0}</strong> last 30d</span>
          <span><strong>{s?.pending ?? 0}</strong> queued{s?.nextScheduledAt ? ` (next ${formatDate(s.nextScheduledAt)})` : ""}</span>
          {(s?.failed ?? 0) > 0 ? <span style={{ color: "#9c2b2b" }}><strong>{s?.failed}</strong> failed</span> : null}
          {(s?.cancelled ?? 0) > 0 ? <span style={{ color: "#8a8377" }}>{s?.cancelled} cancelled</span> : null}
          <span style={{ color: "#8a8377" }}>last sent {formatDate(s?.lastSentAt ?? null)}</span>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#8a8377", fontStyle: "italic" }}>
          Sends directly — no per-message tracking yet.
        </div>
      )}
      {tp.note ? (
        <div style={{ fontSize: 12, color: "#7a5c1e", background: "#fdf6e3", borderRadius: 6, padding: "6px 9px" }}>
          {tp.note}
        </div>
      ) : null}
    </div>
  );
}

export default async function JourneyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <main className="pageShell">
        <div className="pageTopbar">
          <div>
            <h1 className="pageTitle">Customer journey</h1>
          </div>
        </div>
        <section className="detailPanel">
          <p>The journey map is admin-only.</p>
        </section>
      </main>
    );
  }

  const shop = user.shop;
  const stages = buildJourneyStages();
  const data = await loadJourneyData(shop.id);

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Clean Car Collective CRM</p>
          <h1 className="pageTitle">Customer journey</h1>
          <p className="detailSubtitle">
            {shop.name} · every automated email + SMS, with live send stats
          </p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 0, maxWidth: 860 }}>
        {stages.map((stage, i) => (
          <div key={stage.id}>
            <section className="detailPanel" style={{ marginBottom: 0 }}>
              <h2 style={{ marginBottom: 2 }}>{stage.title}</h2>
              <p className="settingsDescription" style={{ marginBottom: 12 }}>{stage.subtitle}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {stage.touchpoints.map((tp) => (
                  <TouchpointCard key={tp.id} tp={tp} stats={data.stats[statKeyToString(tp.stat) ?? ""]} />
                ))}
              </div>
              {stage.id === "upsell" ? (
                <div
                  style={{
                    marginTop: 12,
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: data.conversions.lockInRedemptions > 0 ? "#dcf2e3" : "#f4dede",
                    fontSize: 13,
                    color: data.conversions.lockInRedemptions > 0 ? "#176639" : "#9c2b2b",
                  }}
                >
                  <strong>Drip conversions: {data.conversions.lockInRedemptions} lock-in redemptions</strong>
                  {" · "}{data.conversions.seriesFromDrip} recurring series created from this drip
                  {" · "}{data.conversions.seriesTotal} recurring series total (all sources)
                </div>
              ) : null}
            </section>
            {i < stages.length - 1 ? (
              <div style={{ textAlign: "center", padding: "6px 0", color: "#b0a798", fontSize: 18 }}>↓</div>
            ) : null}
          </div>
        ))}
      </div>
    </main>
  );
}
