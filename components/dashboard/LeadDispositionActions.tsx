"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CooldownControls } from "./CooldownControls";

/**
 * Sales call-disposition chips for a lead.
 *
 * Seven outcomes the rep picks from after a call:
 *   Neutral / Positive / Malfunction → status=contacted
 *   Confirmed                        → status=quoted
 *   Lost                             → status=lost
 *   Booked                           → status=won (+ optional booking flow)
 *   Cool down                        → opens the existing cool-down form
 *
 * Each click flips `last_disposition` and the underlying `status` in a
 * single PATCH and appends an auto-note. Cool down is handled by the
 * existing CooldownControls component (reason + resurface date inline).
 *
 * Two render modes:
 *   `variant="row"`    — full-size pills for the lead detail page.
 *   `variant="compact"` — tight chips for the /sales table column.
 */

export type Disposition =
  | "neutral"
  | "positive"
  | "confirmed"
  | "malfunction"
  | "lost"
  | "cooldown"
  | "booked";

type Props = {
  leadId: string;
  contactId: string;
  currentStatus: string;
  currentDisposition: string | null;
  cooldownUntil: string | null;
  cooldownReason: string | null;
  hasBooking?: boolean;
  variant?: "row" | "compact";
};

type DispositionDef = {
  key: Exclude<Disposition, "cooldown" | "booked">;
  label: string;
  short: string;
  status: "contacted" | "quoted" | "lost";
  note: string;
  bg: string;
  bgActive: string;
};

const DISPOSITIONS: DispositionDef[] = [
  // bgActive values must pass WCAG against white text - the old
  // #9ca3af (neutral) and #d97706 (malfunction) failed at ~2.5:1.
  { key: "neutral",     label: "Neutral",     short: "Neutral",  status: "contacted", note: "Neutral call",      bg: "#e5e7eb", bgActive: "#4b5563" },
  { key: "positive",    label: "Positive",    short: "Positive", status: "contacted", note: "Positive call",      bg: "#dcfce7", bgActive: "#16a34a" },
  { key: "confirmed",   label: "Confirmed",   short: "Confirmed",status: "quoted",    note: "Confirmed interest", bg: "#dbeafe", bgActive: "#2563eb" },
  { key: "malfunction", label: "Malfunction", short: "Issue",    status: "contacted", note: "Couldn't reach (bad number / no answer)", bg: "#fef3c7", bgActive: "#b45309" },
  { key: "lost",        label: "Lost",        short: "Lost",     status: "lost",      note: "Marked lost",        bg: "#fee2e2", bgActive: "#dc2626" },
];

function chipStyle(active: boolean, def: DispositionDef, compact: boolean): React.CSSProperties {
  return {
    padding: compact ? "3px 9px" : "5px 12px",
    fontSize: compact ? 11 : 12,
    fontWeight: active ? 700 : 500,
    border: 0,
    borderRadius: 999,
    background: active ? def.bgActive : def.bg,
    color: active ? "white" : "#1f2937",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

export function LeadDispositionActions({
  leadId,
  contactId,
  currentStatus,
  currentDisposition,
  cooldownUntil,
  cooldownReason,
  hasBooking,
  variant = "row",
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBookedMenu, setShowBookedMenu] = useState(false);
  const compact = variant === "compact";

  const inCooldown = !!cooldownUntil && new Date(cooldownUntil).getTime() > Date.now();

  function applyDisposition(def: DispositionDef) {
    setError(null);
    setPendingKey(def.key);
    startTransition(async () => {
      const now = new Date();
      const stamp = now.toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
      try {
        // Status + disposition in one PATCH.
        const statusResp = await fetch(`/api/leads/${leadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: def.status, last_disposition: def.key }),
        });
        if (!statusResp.ok) throw new Error("status update failed");

        // Auto-note. Separate PATCH so it lands in lead_notes_log.
        await fetch(`/api/leads/${leadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: `${def.note} ${stamp}` }),
        });
      } catch {
        setError("Could not update lead.");
        setPendingKey(null);
        return;
      }
      setPendingKey(null);
      router.refresh();
    });
  }

  function markBookedOnly() {
    setError(null);
    setPendingKey("booked");
    startTransition(async () => {
      const now = new Date();
      const stamp = now.toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
      try {
        const statusResp = await fetch(`/api/leads/${leadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "won", last_disposition: "booked", won_source: "Phone call" }),
        });
        if (!statusResp.ok) throw new Error("status update failed");
        await fetch(`/api/leads/${leadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: `Marked booked ${stamp}` }),
        });
      } catch {
        setError("Could not update lead.");
        setPendingKey(null);
        return;
      }
      setPendingKey(null);
      setShowBookedMenu(false);
      router.refresh();
    });
  }

  // Cool-down active → render the existing inline CooldownControls (reason +
  // resurface date + Bring back link). Don't show the other chips while in
  // cool-down; the rep needs to bring the lead back first.
  if (inCooldown) {
    return (
      <CooldownControls
        leadId={leadId}
        cooldownUntil={cooldownUntil}
        cooldownReason={cooldownReason}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: compact ? 3 : 6, alignItems: "center" }}>
        {DISPOSITIONS.map((def) => {
          const active = currentDisposition === def.key;
          return (
            <button
              key={def.key}
              type="button"
              style={chipStyle(active, def, compact)}
              disabled={pending}
              onClick={() => applyDisposition(def)}
              title={def.label}
            >
              {pendingKey === def.key ? "…" : compact ? def.short : def.label}
            </button>
          );
        })}
        {!hasBooking ? (
          <button
            type="button"
            style={chipStyle(currentDisposition === "booked", {
              key: "lost", label: "", short: "", status: "lost", note: "",
              bg: "#fae8ff", bgActive: "#7e22ce",
            }, compact)}
            disabled={pending}
            onClick={() => setShowBookedMenu((v) => !v)}
            title="Booked"
          >
            {pendingKey === "booked" ? "…" : "Booked"}
          </button>
        ) : null}
        <CooldownChipTrigger leadId={leadId} compact={compact} />
      </div>
      {showBookedMenu ? (
        <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "4px 0" }}>
          <button
            type="button"
            className="buttonGhost"
            style={{ fontSize: 11, padding: "2px 8px" }}
            disabled={pending}
            onClick={markBookedOnly}
          >
            {pending ? "Saving…" : "Just mark won"}
          </button>
          <Link
            href={`/contacts/${contactId}`}
            className="buttonPrimary"
            style={{ fontSize: 11, padding: "2px 8px" }}
          >
            Open booking flow
          </Link>
          <button
            type="button"
            className="buttonGhost"
            style={{ fontSize: 11, padding: "2px 8px" }}
            onClick={() => setShowBookedMenu(false)}
          >
            Cancel
          </button>
        </div>
      ) : null}
      {error ? <span style={{ fontSize: 11, color: "#b91c1c" }}>{error}</span> : null}
      {!showBookedMenu && currentStatus === "lost" ? (
        <span style={{ fontSize: 11, color: "#9e9189" }}>Lead is marked lost — click any chip to reopen.</span>
      ) : null}
    </div>
  );
}

/**
 * Inline "Cool down" trigger chip. Toggles a small panel below the row
 * via the existing CooldownControls component (its closed-state is just
 * a "Cool down" button which we replace with this themed chip).
 */
function CooldownChipTrigger({ leadId, compact }: { leadId: string; compact: boolean }) {
  const [show, setShow] = useState(false);
  if (!show) {
    return (
      <button
        type="button"
        style={{
          padding: compact ? "2px 6px" : "4px 10px",
          fontSize: compact ? 11 : 12,
          fontWeight: 500,
          border: 0,
          borderRadius: 999,
          background: "#e0f2fe",
          color: "#075985",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
        onClick={() => setShow(true)}
        title="Mark as cool down"
      >
        ❄ Cool down
      </button>
    );
  }
  return (
    <div style={{ width: "100%", padding: "4px 0" }}>
      <CooldownControls leadId={leadId} cooldownUntil={null} cooldownReason={null} />
    </div>
  );
}
