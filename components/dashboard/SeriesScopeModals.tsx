"use client";

/**
 * Scope-choice + series-edit modals for recurring bookings (step 3).
 *
 * Two flows:
 *   - SeriesScopeChoiceModal: "Just this one / Whole recurring series"
 *     dialog shown before cancel or edit. Drives the next step.
 *   - SeriesEditFormModal: minimal form for editing series-wide fields
 *     (service_name / price / duration / location / address / notes).
 *     Date/time are intentionally excluded — recurrence is series-locked.
 *
 * Uses createPortal to document.body to escape the global nav's
 * backdrop-filter containing block — same workaround as NewBookingModal.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { BookingWithRelations } from "@/lib/dashboard/types";

type ScopeMode = "single" | "series";

// ── Scope choice modal ───────────────────────────────────────────────────

export function SeriesScopeChoiceModal({
  action,
  onChoose,
  onClose,
}: {
  action: "edit" | "cancel";
  onChoose: (scope: ScopeMode, reason?: string) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [scope, setScope] = useState<ScopeMode>("single");
  const [reason, setReason] = useState("");

  if (!mounted) return null;

  const verb = action === "edit" ? "edit" : "cancel";
  const continueLabel = action === "edit" ? "Continue to edit →" : "Continue to cancel →";

  const content = (
    <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalPanel" role="dialog" aria-modal="true" style={{ maxWidth: 480 }}>
        <div className="modalHeader">
          <h2>Recurring booking</h2>
          <button className="modalClose" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modalBody" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
            This is part of a recurring series. What would you like to {verb}?
          </p>

          <label
            style={{
              display: "flex",
              gap: 10,
              padding: "12px 14px",
              border: `2px solid ${scope === "single" ? "#1a4d2e" : "#e8e0d6"}`,
              borderRadius: 10,
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="series-scope"
              value="single"
              checked={scope === "single"}
              onChange={() => setScope("single")}
            />
            <span>
              <strong style={{ display: "block" }}>Just this booking</strong>
              <span style={{ fontSize: 13, color: "#7a6f68" }}>
                Only the occurrence on this date. Future bookings in the series stay unchanged.
              </span>
            </span>
          </label>

          <label
            style={{
              display: "flex",
              gap: 10,
              padding: "12px 14px",
              border: `2px solid ${scope === "series" ? "#1a4d2e" : "#e8e0d6"}`,
              borderRadius: 10,
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="series-scope"
              value="series"
              checked={scope === "series"}
              onChange={() => setScope("series")}
            />
            <span>
              <strong style={{ display: "block" }}>Whole recurring series</strong>
              <span style={{ fontSize: 13, color: "#7a6f68" }}>
                {action === "cancel"
                  ? "Cancel all future occurrences and stop the series. Past + individually-edited bookings are left alone."
                  : "Update all future occurrences. Individually-edited bookings are left alone."}
              </span>
            </span>
          </label>

          {action === "cancel" && scope === "series" ? (
            <div>
              <label htmlFor="cancel-reason" style={{ display: "block", fontSize: 13, color: "#7a6f68", marginBottom: 4 }}>
                Reason (optional)
              </label>
              <textarea
                id="cancel-reason"
                className="detailTextarea"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. customer moved away"
              />
            </div>
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button className="buttonGhost buttonNeutral" onClick={onClose}>Cancel</button>
            <button
              className="buttonPrimary"
              onClick={() => onChoose(scope, scope === "series" && action === "cancel" ? reason || undefined : undefined)}
            >
              {continueLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

// ── Series edit form modal ───────────────────────────────────────────────

export function SeriesEditFormModal({
  booking,
  onClose,
  onSaved,
}: {
  booking: BookingWithRelations;
  onClose: () => void;
  onSaved: (bookingsUpdated: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [serviceName, setServiceName] = useState(booking.service_name);
  const [priceEstimate, setPriceEstimate] = useState(String(booking.price_estimate ?? ""));
  const [durationMinutes, setDurationMinutes] = useState(String(booking.duration_minutes ?? ""));
  const [locationType, setLocationType] = useState(booking.location_type ?? "");
  const [serviceAddress, setServiceAddress] = useState(booking.service_address ?? "");
  const [notes, setNotes] = useState(booking.notes ?? "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!mounted) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!booking.series_id) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/booking-series/${booking.series_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "series",
          updates: {
            serviceName,
            priceEstimate: priceEstimate ? Number(priceEstimate) : null,
            durationMinutes: durationMinutes ? Number(durationMinutes) : null,
            locationType: locationType || null,
            serviceAddress: serviceAddress || null,
            notes: notes || null,
          },
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; bookingsUpdated?: number };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to update series.");
        setSubmitting(false);
        return;
      }
      onSaved(data.bookingsUpdated ?? 0);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  const content = (
    <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalPanel" role="dialog" aria-modal="true" style={{ maxWidth: 540 }}>
        <div className="modalHeader">
          <h2>Edit whole series</h2>
          <button className="modalClose" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="modalBody" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#7a6f68", lineHeight: 1.5 }}>
            Editing the series updates all future occurrences. Dates and cadence are series-locked — to change the schedule, cancel this series and create a new one.
          </p>

          <label>
            <span style={{ display: "block", fontSize: 13, color: "#7a6f68", marginBottom: 4 }}>Service name</span>
            <input className="detailInput" value={serviceName} onChange={(e) => setServiceName(e.target.value)} required />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              <span style={{ display: "block", fontSize: 13, color: "#7a6f68", marginBottom: 4 }}>Price per visit</span>
              <input
                className="detailInput"
                type="number"
                min="0"
                step="0.01"
                value={priceEstimate}
                onChange={(e) => setPriceEstimate(e.target.value)}
                placeholder="—"
              />
            </label>
            <label>
              <span style={{ display: "block", fontSize: 13, color: "#7a6f68", marginBottom: 4 }}>Duration (min)</span>
              <input
                className="detailInput"
                type="number"
                min="0"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                placeholder="—"
              />
            </label>
          </div>

          <label>
            <span style={{ display: "block", fontSize: 13, color: "#7a6f68", marginBottom: 4 }}>Location</span>
            <select className="detailInput" value={locationType} onChange={(e) => setLocationType(e.target.value)}>
              <option value="">— Not set —</option>
              <option value="shop">Shop</option>
              <option value="mobile">Mobile</option>
            </select>
          </label>

          <label>
            <span style={{ display: "block", fontSize: 13, color: "#7a6f68", marginBottom: 4 }}>Service address (mobile)</span>
            <input
              className="detailInput"
              value={serviceAddress}
              onChange={(e) => setServiceAddress(e.target.value)}
              placeholder="—"
            />
          </label>

          <label>
            <span style={{ display: "block", fontSize: 13, color: "#7a6f68", marginBottom: 4 }}>Notes</span>
            <textarea
              className="detailTextarea"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

          {error ? <p style={{ color: "#c0392b", fontSize: 13, margin: 0 }}>{error}</p> : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="buttonGhost buttonNeutral" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="buttonPrimary" disabled={submitting}>
              {submitting ? "Saving…" : "Save series"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
