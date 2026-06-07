"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Inline "Cool down" toggle for a sales-queue lead row.
 *
 * Two modes:
 *  - Lead has no active cool-down → small "Cool down" button that opens an
 *    inline mini-form (reason textarea + resurface date input).
 *  - Lead is in cool-down → renders the reason + resurface date inline,
 *    plus a "Bring back" link that clears the flag.
 *
 * Posts to /api/leads/[id]/cooldown. Refreshes the route on success so the
 * lead disappears from this bucket and lands in the cool-down tab.
 */

type Props = {
  leadId: string;
  cooldownUntil: string | null;
  cooldownReason: string | null;
};

function defaultResurfaceYmd(): string {
  // Default: 2 weeks from today, NZ-local.
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
}

export function CooldownControls({ leadId, cooldownUntil, cooldownReason }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState(defaultResurfaceYmd());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const inCooldown = !!cooldownUntil && new Date(cooldownUntil).getTime() > Date.now();

  if (inCooldown) {
    const untilLabel = cooldownUntil
      ? new Date(cooldownUntil).toLocaleDateString("en-NZ", {
          timeZone: "Pacific/Auckland",
          day: "numeric",
          month: "short",
        })
      : "—";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 12, color: "#7a655a", fontStyle: "italic" }}>
          {cooldownReason || "(no reason)"}
        </span>
        <span style={{ fontSize: 11, color: "#9e9189" }}>
          Resurface {untilLabel} ·{" "}
          <button
            type="button"
            className="textLink"
            style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "#2563eb", cursor: pending ? "wait" : "pointer" }}
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await fetch(`/api/leads/${leadId}/cooldown`, { method: "DELETE" });
                if (!res.ok) {
                  const body = await res.json().catch(() => ({}));
                  setError(body.error || `HTTP ${res.status}`);
                  return;
                }
                router.refresh();
              });
            }}
          >
            Bring back
          </button>
        </span>
        {error ? <span style={{ fontSize: 11, color: "#b91c1c" }}>{error}</span> : null}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="buttonGhost"
        style={{ fontSize: 12, padding: "2px 8px" }}
        onClick={() => setOpen(true)}
      >
        Cool down
      </button>
    );
  }

  function submit() {
    if (!reason.trim()) {
      setError("Reason required");
      return;
    }
    if (!until) {
      setError("Pick a resurface date");
      return;
    }
    const untilIso = new Date(`${until}T08:00:00+12:00`).toISOString();
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/leads/${leadId}/cooldown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), until: untilIso }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
      <textarea
        className="detailInput"
        rows={2}
        placeholder="Why hold off? (e.g. just bought elsewhere, away till August)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ fontSize: 12 }}
      />
      <label style={{ fontSize: 11, color: "#7a655a" }}>
        Resurface on
        <input
          type="date"
          className="detailInput"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          style={{ fontSize: 12, marginLeft: 6 }}
        />
      </label>
      <div style={{ display: "flex", gap: 4 }}>
        <button type="button" className="buttonPrimary" style={{ fontSize: 12, padding: "2px 8px" }} disabled={pending} onClick={submit}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="buttonGhost" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => { setOpen(false); setError(null); }}>
          Cancel
        </button>
      </div>
      {error ? <span style={{ fontSize: 11, color: "#b91c1c" }}>{error}</span> : null}
    </div>
  );
}
