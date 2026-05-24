"use client";

/**
 * "Block day" button + modal. Lets any signed-in staff block the day on
 * the shop's Google Calendar — either all-day or a specific time range.
 *
 * POSTs to /api/calendar/block-day which forwards to the per-shop Apps
 * Script (same script that serves availability reads, just with a new
 * doPost handler that creates calendar events).
 *
 * The CRM doesn't track blocks itself — Google Calendar is source of
 * truth. Customer booking form picks up the new block within ~60s (cache
 * TTL on the public availability endpoint).
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

type BlockDayButtonProps = {
  day: string; // yyyy-MM-dd
};

type Scope = "all_day" | "time_range";

export function BlockDayButton({ day }: BlockDayButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("all_day");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function reset() {
    setScope("all_day");
    setStartTime("09:00");
    setEndTime("12:00");
    setReason("");
    setError("");
  }

  async function handleSubmit() {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/calendar/block-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          day,
          scope,
          start_time: scope === "time_range" ? startTime : undefined,
          end_time: scope === "time_range" ? endTime : undefined,
          reason: reason.trim() || undefined,
          action: "block",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data?.error ?? `Failed (HTTP ${res.status})`);
        return;
      }
      setOpen(false);
      reset();
      // Slight delay so the Apps Script's availability cache can clear,
      // then refresh so the booking form / calendar sees the new block.
      setTimeout(() => router.refresh(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const modal = !mounted ? null : (
    <div className="modalOverlay" onClick={() => !submitting && setOpen(false)}>
      <div className="modalPanel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <header style={{ padding: "20px 24px", borderBottom: "1px solid var(--line, #e8e0d6)" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Block {day} on the calendar</h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted, #7a6f68)" }}>
            Creates an event on this shop&apos;s Google Calendar. Customers won&apos;t see
            blocked slots in the booking form.
          </p>
        </header>

        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="radio"
                name="block-scope"
                value="all_day"
                checked={scope === "all_day"}
                onChange={() => setScope("all_day")}
              />
              All day
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="radio"
                name="block-scope"
                value="time_range"
                checked={scope === "time_range"}
                onChange={() => setScope("time_range")}
              />
              Time range
            </label>
          </fieldset>

          {scope === "time_range" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--muted, #7a6f68)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Start
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  style={{ padding: 9, border: "1px solid var(--line, #e8e0d6)", borderRadius: 8, fontSize: 14, textTransform: "none", fontWeight: 500, color: "var(--ink, #1a1713)" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--muted, #7a6f68)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                End
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  style={{ padding: 9, border: "1px solid var(--line, #e8e0d6)", borderRadius: 8, fontSize: 14, textTransform: "none", fontWeight: 500, color: "var(--ink, #1a1713)" }}
                />
              </label>
            </div>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--muted, #7a6f68)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Reason (optional)
            <input
              type="text"
              placeholder="e.g. Public holiday, staff training"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={120}
              style={{ padding: 9, border: "1px solid var(--line, #e8e0d6)", borderRadius: 8, fontSize: 14, textTransform: "none", fontWeight: 500, color: "var(--ink, #1a1713)" }}
            />
          </label>

          {error && <p style={{ margin: 0, color: "var(--danger, #c0392b)", fontSize: 13, fontWeight: 600 }}>{error}</p>}
        </div>

        <footer style={{ padding: "16px 24px", borderTop: "1px solid var(--line, #e8e0d6)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="buttonGhost" onClick={() => { reset(); setOpen(false); }} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="buttonPrimary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Blocking…" : "Block day"}
          </button>
        </footer>
      </div>
    </div>
  );

  return (
    <>
      <button type="button" className="buttonGhost" onClick={() => setOpen(true)}>
        Block day
      </button>
      {open && modal && createPortal(modal, document.body)}
    </>
  );
}
