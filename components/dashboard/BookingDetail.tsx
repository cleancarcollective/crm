"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { getBookingAddOnsLabel } from "@/lib/bookings/addOns";
import { ContactNameLink } from "@/components/dashboard/ContactNameLink";
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
  const [savedMessage, setSavedMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pickupPending, setPickupPending] = useState(false);
  const [pickupMessage, setPickupMessage] = useState<string>("");
  const addOns = getBookingAddOnsLabel(booking.raw_payload);

  const dayKey = getZonedDateKey(booking.scheduled_start, shop.timezone);

  function handleSave(sendUpdateEmail = false) {
    setErrorMessage("");
    setSavedMessage("");
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
          send_update_email: sendUpdateEmail,
        }),
      });
      if (!res.ok) {
        setErrorMessage("Failed to save. Please try again.");
        return;
      }
      const data = (await res.json()) as { update_email_status?: "sent" | "skipped" | "failed" | "not_requested" };
      if (sendUpdateEmail) {
        if (data.update_email_status === "sent") {
          setSavedMessage("Saved + emailed ✓");
        } else if (data.update_email_status === "skipped") {
          setSavedMessage("Saved, no update email needed ✓");
        } else if (data.update_email_status === "failed") {
          setSavedMessage("Saved, but email failed");
        } else {
          setSavedMessage("Saved ✓");
        }
      } else {
        setSavedMessage("Saved ✓");
      }
      router.refresh();
    });
  }

  function handlePickupReady() {
    if (!window.confirm("Mark this job as pick-up ready? This will email and text the customer and set the booking to Completed.")) return;
    setPickupMessage("");
    setPickupPending(true);
    fetch(`/api/bookings/${booking.id}/pickup`, { method: "POST" })
      .then(async (res) => {
        const data = (await res.json()) as { success: boolean; emailSent: boolean; smsSent: boolean; afterHours: boolean; smsError?: string };
        if (!res.ok || !data.success) {
          setPickupMessage("Failed to send pick-up notification.");
          return;
        }
        const parts: string[] = [];
        if (data.emailSent) parts.push("email sent");
        if (data.smsSent) parts.push("SMS sent");
        if (!data.emailSent && !data.smsSent) parts.push("no contact info on file");
        setPickupMessage(`Pick-up ready! (${parts.join(", ")})${data.afterHours ? " — after-hours variant" : ""}`);
        setStatus("completed");
        router.refresh();
      })
      .catch(() => setPickupMessage("Failed to send pick-up notification."))
      .finally(() => setPickupPending(false));
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
          <p className="detailSubtitle">
            <ContactNameLink
              contactId={booking.contact?.id ?? booking.contact_id}
              name={getBookingDisplayName(booking)}
              className="profileNameLink"
            />
          </p>
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
            {savedMessage && !isPending && <span className="editorSaved">{savedMessage}</span>}
            {pickupMessage && !pickupPending && <span className="editorSaved">{pickupMessage}</span>}
            {errorMessage && <span className="editorError">{errorMessage}</span>}
            <button className="buttonGhost" onClick={handleDelete} disabled={isPending || pickupPending}>
              Delete
            </button>
            <button className="buttonGhost buttonNeutral" onClick={() => handleSave(true)} disabled={isPending || pickupPending}>
              {isPending ? "Saving…" : "Save + email update"}
            </button>
            <button className="buttonPrimary" onClick={() => handleSave(false)} disabled={isPending || pickupPending}>
              {isPending ? "Saving…" : "Save"}
            </button>
            <button className="buttonPickup" onClick={handlePickupReady} disabled={isPending || pickupPending}>
              {pickupPending ? "Sending…" : "🚗 Pick-up Ready"}
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
          <div className="detailItem">
            <span>Name</span>
            <strong>
              <ContactNameLink
                contactId={booking.contact?.id ?? booking.contact_id}
                name={getBookingDisplayName(booking)}
                className="profileNameLink"
              />
            </strong>
          </div>
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
