"use client";

import { useState, useTransition, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { SeriesEditFormModal } from "@/components/dashboard/SeriesScopeModals";
import type {
  BookingSeriesRecord,
  BookingWithRelations,
} from "@/lib/dashboard/types";

type Props = {
  series: BookingSeriesRecord;
};

export function SeriesActions({ series }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const isActive = series.status === "active";
  const isPaused = series.status === "paused";
  const isCancelled = series.status === "cancelled";

  function postSimple(path: string) {
    setError("");
    startTransition(async () => {
      const res = await fetch(path, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Action failed.");
        return;
      }
      router.refresh();
    });
  }

  // SeriesEditFormModal posts to /api/booking-series/[id] using
  // booking.series_id — we shim a minimal booking with the series id and
  // current series field values so the modal works unchanged.
  const editShim: BookingWithRelations = {
    id: series.id,
    shop_id: series.shop_id,
    contact_id: series.contact_id,
    vehicle_id: series.vehicle_id,
    booking_source: series.booking_source,
    service_name: series.service_name,
    service_details: series.service_details,
    scheduled_start: series.first_occurrence_at,
    scheduled_end: null,
    status: series.status,
    price_estimate: series.price_estimate,
    notes: series.notes,
    service_id: null,
    duration_minutes: series.duration_minutes,
    location_type: series.location_type,
    service_address: series.service_address,
    raw_payload: {},
    series_id: series.id,
    series_sequence: null,
    series_overridden: false,
    created_at: series.created_at,
    updated_at: series.updated_at,
    contact: null,
    vehicle: null,
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {isActive ? (
        <button
          type="button"
          className="buttonGhost"
          disabled={isPending}
          onClick={() => postSimple(`/api/booking-series/${series.id}/pause`)}
        >
          {isPending ? "Pausing…" : "Pause series"}
        </button>
      ) : null}

      {isPaused ? (
        <button
          type="button"
          className="buttonPrimary"
          disabled={isPending}
          onClick={() => postSimple(`/api/booking-series/${series.id}/resume`)}
        >
          {isPending ? "Resuming…" : "Resume series"}
        </button>
      ) : null}

      <button
        type="button"
        className="buttonGhost"
        disabled={isCancelled || isPending}
        onClick={() => setEditOpen(true)}
      >
        Edit series
      </button>

      <button
        type="button"
        className="buttonGhost buttonDanger"
        disabled={isCancelled || isPending}
        onClick={() => setCancelOpen(true)}
      >
        Cancel series
      </button>

      {error ? (
        <span style={{ color: "#c0392b", fontSize: 13 }}>{error}</span>
      ) : null}

      {editOpen ? (
        <SeriesEditFormModal
          booking={editShim}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      {cancelOpen ? (
        <CancelSeriesModal
          seriesId={series.id}
          onClose={() => setCancelOpen(false)}
          onCancelled={() => {
            setCancelOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function CancelSeriesModal({
  seriesId,
  onClose,
  onCancelled,
}: {
  seriesId: string;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  async function handleConfirm() {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/booking-series/${seriesId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "series", reason: reason || null }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to cancel series.");
        setSubmitting(false);
        return;
      }
      onCancelled();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  const content = (
    <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalPanel" role="dialog" aria-modal="true" style={{ maxWidth: 480 }}>
        <div className="modalHeader">
          <h2>Cancel recurring series?</h2>
          <button className="modalClose" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modalBody" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#7a6f68", lineHeight: 1.5 }}>
            This will cancel the series and all future non-overridden occurrences. Past occurrences stay on the calendar for history. The customer and team will be emailed.
          </p>
          <label>
            <span style={{ display: "block", fontSize: 13, color: "#7a6f68", marginBottom: 4 }}>
              Reason (optional, included in the customer email)
            </span>
            <textarea
              className="detailTextarea"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer requested via phone…"
            />
          </label>
          {error ? <p style={{ color: "#c0392b", fontSize: 13, margin: 0 }}>{error}</p> : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="buttonGhost buttonNeutral" onClick={onClose} disabled={submitting}>
              Keep series
            </button>
            <button type="button" className="buttonPrimary buttonDanger" onClick={handleConfirm} disabled={submitting}>
              {submitting ? "Cancelling…" : "Cancel series"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
