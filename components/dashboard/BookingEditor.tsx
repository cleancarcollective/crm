"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { getZonedDateKey } from "@/lib/dashboard/bookings";
import type { BookingWithRelations, ShopRecord } from "@/lib/dashboard/types";

type BookingEditorProps = {
  booking: BookingWithRelations;
  shop: ShopRecord;
};

function toDateTimeLocal(iso: string) {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function BookingEditor({ booking, shop }: BookingEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serviceName, setServiceName] = useState(booking.service_name);
  const [status, setStatus] = useState(booking.status);
  const [scheduledStart, setScheduledStart] = useState(toDateTimeLocal(booking.scheduled_start));
  const [durationMinutes, setDurationMinutes] = useState(String(booking.duration_minutes ?? ""));
  const [priceEstimate, setPriceEstimate] = useState(String(booking.price_estimate ?? ""));
  const [locationType, setLocationType] = useState(booking.location_type ?? "");
  const [notes, setNotes] = useState(booking.notes ?? "");
  const [errorMessage, setErrorMessage] = useState("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dayKey = getZonedDateKey(booking.scheduled_start, shop.timezone);

  function handleSave() {
    setErrorMessage("");
    setSavedAt(null);

    startTransition(async () => {
      const response = await fetch(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_name: serviceName,
          status,
          scheduled_start: new Date(scheduledStart).toISOString(),
          duration_minutes: durationMinutes ? Number(durationMinutes) : null,
          price_estimate: priceEstimate ? Number(priceEstimate) : null,
          location_type: locationType || null,
          notes: notes || null
        })
      });

      if (!response.ok) {
        setErrorMessage("Failed to save booking. Please try again.");
        return;
      }

      setSavedAt(new Date());
      router.refresh();
    });
  }

  function handleDelete() {
    const confirmed = window.confirm("Delete this booking? This cannot be undone.");
    if (!confirmed) return;

    setErrorMessage("");

    startTransition(async () => {
      const response = await fetch(`/api/bookings/${booking.id}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        setErrorMessage("Failed to delete booking. Please try again.");
        return;
      }

      router.push(`/day/${dayKey}`);
    });
  }

  return (
    <div className="detailPanel">
      <div className="editorHeader">
        <h2>Edit Booking</h2>
        <div className="editorActions">
          {savedAt && !isPending && (
            <span className="editorSaved">Saved ✓</span>
          )}
          <button type="button" className="buttonGhost" onClick={handleDelete} disabled={isPending}>
            Delete
          </button>
          <button type="button" className="buttonPrimary" onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="editorGrid">
        <label className="editorField">
          <span>Service</span>
          <input value={serviceName} onChange={(event) => setServiceName(event.target.value)} />
        </label>

        <label className="editorField">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="reminder_sent">Reminder Sent</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No Show</option>
          </select>
        </label>

        <label className="editorField">
          <span>Start</span>
          <input
            type="datetime-local"
            value={scheduledStart}
            onChange={(event) => setScheduledStart(event.target.value)}
          />
        </label>

        <label className="editorField">
          <span>Duration (minutes)</span>
          <input
            type="number"
            min="0"
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
          />
        </label>

        <label className="editorField">
          <span>Price Estimate</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={priceEstimate}
            onChange={(event) => setPriceEstimate(event.target.value)}
          />
        </label>

        <label className="editorField">
          <span>Location</span>
          <input value={locationType} onChange={(event) => setLocationType(event.target.value)} />
        </label>

        <label className="editorField editorFieldFull">
          <span>Notes</span>
          <textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
      </div>

      {errorMessage ? <p className="editorError">{errorMessage}</p> : null}
    </div>
  );
}
