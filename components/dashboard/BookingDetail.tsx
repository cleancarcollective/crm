"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { getBookingAddOnsLabel } from "@/lib/bookings/addOns";
import { getBookingDisplayName, getVehicleLabel, getZonedDateKey } from "@/lib/dashboard/bookings";
import type { BookingWithRelations, ShopRecord } from "@/lib/dashboard/types";

type BookingDetailProps = {
  booking: BookingWithRelations;
  shop: ShopRecord;
};

function toDateTimeLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ReadItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="detailItem">
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function EditItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="detailItem detailItemEdit">
      <span>{label}</span>
      {children}
    </div>
  );
}

export function BookingDetail({ booking, shop }: BookingDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [serviceName, setServiceName] = useState(booking.service_name);
  const [status, setStatus] = useState(booking.status);
  const [scheduledStart, setScheduledStart] = useState(toDateTimeLocal(booking.scheduled_start));
  const [durationMinutes, setDurationMinutes] = useState(String(booking.duration_minutes ?? ""));
  const [priceEstimate, setPriceEstimate] = useState(String(booking.price_estimate ?? ""));
  const [locationType, setLocationType] = useState(booking.location_type ?? "");
  const [notes, setNotes] = useState(booking.notes ?? "");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const addOns = getBookingAddOnsLabel(booking.raw_payload);

  const dayKey = getZonedDateKey(booking.scheduled_start, shop.timezone);

  function handleSave() {
    setErrorMessage("");
    setSavedAt(null);
    startTransition(async () => {
      const res = await fetch(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_name: serviceName,
          status,
          scheduled_start: new Date(scheduledStart).toISOString(),
          duration_minutes: durationMinutes ? Number(durationMinutes) : null,
          price_estimate: priceEstimate ? Number(priceEstimate) : null,
          location_type: locationType || null,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        setErrorMessage("Failed to save. Please try again.");
        return;
      }
      setSavedAt(new Date());
      router.refresh();
    });
  }

  function handleDelete() {
    if (!window.confirm("Delete this booking? This cannot be undone.")) return;
    setErrorMessage("");
    startTransition(async () => {
      const res = await fetch(`/api/bookings/${booking.id}`, { method: "DELETE" });
      if (!res.ok) {
        setErrorMessage("Failed to delete. Please try again.");
        return;
      }
      router.push(`/day/${dayKey}`);
    });
  }

  return (
    <section className="detailShell">

      {/* ── Header ── */}
      <div className="detailHeader">
        <div className="detailHeaderLeft">
          <Link href={`/day/${dayKey}`} className="textLink">
            ← Back to day
          </Link>
          <input
            className="detailTitleInput"
            value={serviceName}
            onChange={(e) => setServiceName(e.target.value)}
            placeholder="Service name"
          />
          <p className="detailSubtitle">{getBookingDisplayName(booking)}</p>
        </div>

        <div className="detailHeaderRight">
          <select
            className="statusSelect"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            data-status={status}
          >
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="reminder_sent">Reminder Sent</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No Show</option>
          </select>

          <div className="detailActions">
            {savedAt && !isPending && <span className="editorSaved">Saved ✓</span>}
            {errorMessage && <span className="editorError">{errorMessage}</span>}
            <button className="buttonGhost" onClick={handleDelete} disabled={isPending}>
              Delete
            </button>
            <button className="buttonPrimary" onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="detailGrid">

        {/* Booking panel */}
        <div className="detailPanel">
          <h2>Booking</h2>

          <EditItem label="Start">
            <input
              className="detailInput"
              type="datetime-local"
              value={scheduledStart}
              onChange={(e) => setScheduledStart(e.target.value)}
            />
          </EditItem>

          <EditItem label="Duration (min)">
            <input
              className="detailInput"
              type="number"
              min="0"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              placeholder="—"
            />
          </EditItem>

          <EditItem label="Price">
            <input
              className="detailInput"
              type="number"
              min="0"
              step="0.01"
              value={priceEstimate}
              onChange={(e) => setPriceEstimate(e.target.value)}
              placeholder="—"
            />
          </EditItem>

          <EditItem label="Location">
            <input
              className="detailInput"
              value={locationType}
              onChange={(e) => setLocationType(e.target.value)}
              placeholder="—"
            />
          </EditItem>

          <ReadItem label="Source" value={booking.booking_source} />
          <ReadItem label="Service ID" value={booking.service_id} />
          <ReadItem label="Add-ons" value={addOns} />
        </div>

        {/* Contact panel */}
        <div className="detailPanel">
          <h2>Contact</h2>
          <ReadItem label="Name" value={getBookingDisplayName(booking)} />
          <ReadItem label="Email" value={booking.contact?.email ?? null} />
          <ReadItem label="Phone" value={booking.contact?.phone ?? null} />

          <h2 className="detailSubheading">Vehicle</h2>
          <ReadItem label="Vehicle" value={getVehicleLabel(booking)} />
          <ReadItem label="Size" value={booking.vehicle?.size ?? null} />
          <ReadItem label="Rego" value={booking.vehicle?.rego ?? null} />
        </div>
      </div>

      {/* Notes */}
      <div className="detailPanel">
        <h2>Notes</h2>
        <textarea
          className="detailTextarea"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="No notes recorded."
        />
      </div>

      {/* Raw payload */}
      <div className="detailPanel">
        <h2>Raw Payload</h2>
        <pre className="payloadBox">{JSON.stringify(booking.raw_payload, null, 2)}</pre>
      </div>

    </section>
  );
}
