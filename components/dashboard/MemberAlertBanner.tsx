import type { MemberAlert } from "@/lib/collective/memberAlert";
import { memberAlertLines } from "@/lib/collective/memberAlert";

/**
 * Big "Collective member" banner on the booking page. Deliberately loud:
 * staff must see the plan and washes-this-year before anything else.
 */
export function MemberAlertBanner({ alert, bookingIsPast }: { alert: MemberAlert; bookingIsPast: boolean }) {
  const l = memberAlertLines(alert, bookingIsPast);
  const pastDue = alert.status === "past_due";
  return (
    <div
      role="alert"
      style={{
        margin: "0 0 16px 0",
        padding: "18px 20px",
        background: pastDue ? "#991b1b" : "#14532d",
        color: "#fff",
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(0,0,0,.15)",
      }}
    >
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "0.06em", marginBottom: 8 }}>⚠️ {l.headline}</div>
      <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 6 }}>{l.plan}</div>
      <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 8 }}>{l.washes}</div>
      <div style={{ fontSize: 14, display: "flex", gap: 14, flexWrap: "wrap", opacity: 0.95 }}>
        <span>
          Status: <b>{l.status}</b>
        </span>
        <span>{l.credit}</span>
        {l.since ? <span>{l.since}</span> : null}
      </div>
      <div style={{ fontSize: 13, marginTop: 6, opacity: 0.85 }}>{l.recent}</div>
    </div>
  );
}
