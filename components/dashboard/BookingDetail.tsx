"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { getBookingAddOnsLabel } from "@/lib/bookings/addOns";
import { ContactNameLink } from "@/components/dashboard/ContactNameLink";
import { DateTimeField } from "@/components/dashboard/DateTimeField";
import { SeriesEditFormModal, SeriesScopeChoiceModal } from "@/components/dashboard/SeriesScopeModals";
import { getBookingDisplayName, getVehicleLabel, getZonedDateKey } from "@/lib/dashboard/bookings";
import type { BookingWithRelations, ShopRecord } from "@/lib/dashboard/types";

type BookingDetailProps = {
  booking: BookingWithRelations;
  shop: ShopRecord;
  /** Parent series status (active/paused/cancelled). null if not in a series. */
  seriesStatus?: string | null;
};

// Wall-clock string for <input type="datetime-local"> rendered in the
// SHOP timezone (not browser or SSR node tz). Prevents cross-tz drift
// where a stored 22 July 01:30 NZ time gets rendered as 21 July 09:30
// on a UTC-4 machine and re-saved incorrectly.
import { formatInTimeZone as _formatInTz, fromZonedTime } from "date-fns-tz";
function toDateTimeLocal(iso: string, timezone: string) {
  return _formatInTz(new Date(iso), timezone, "yyyy-MM-dd'T'HH:mm");
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

export function BookingDetail({ booking, shop, seriesStatus = null }: BookingDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Series-scope modal state. "edit" / "cancel" pick which flow runs after
  // the scope-choice resolves. seriesEditOpen drives the bulk-edit form.
  const inSeries = Boolean(booking.series_id);
  const seriesCancelled = seriesStatus === "cancelled";
  const [scopeChoice, setScopeChoice] = useState<null | "edit" | "cancel">(null);
  const [seriesEditOpen, setSeriesEditOpen] = useState(false);
  const [seriesBanner, setSeriesBanner] = useState<string>("");

  const [serviceName, setServiceName] = useState(booking.service_name);
  const [status, setStatus] = useState(booking.status);
  const [scheduledStart, setScheduledStart] = useState(toDateTimeLocal(booking.scheduled_start, shop.timezone));
  const [durationMinutes, setDurationMinutes] = useState(String(booking.duration_minutes ?? ""));
  const [priceEstimate, setPriceEstimate] = useState(String(booking.price_estimate ?? ""));
  const [locationType, setLocationType] = useState(booking.location_type ?? "");
  const [serviceAddress, setServiceAddress] = useState(booking.service_address ?? "");
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
          scheduled_start: fromZonedTime(scheduledStart, shop.timezone).toISOString(),
          duration_minutes: durationMinutes ? Number(durationMinutes) : null,
          price_estimate: priceEstimate ? Number(priceEstimate) : null,
          location_type: locationType || null,
          service_address: locationType === "mobile" ? (serviceAddress.trim() || null) : null,
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

          {/* Fixed-height status line so save/pickup feedback appearing
              never reflows the button row underneath it. */}
          <div className="detailStatusLine">
            {savedMessage && !isPending && <span className="editorSaved">{savedMessage}</span>}
            {pickupMessage && !pickupPending && <span className="editorSaved">{pickupMessage}</span>}
            {seriesBanner && <span className="editorSaved">{seriesBanner}</span>}
            {errorMessage && <span className="editorError">{errorMessage}</span>}
          </div>
          <div className="detailActions">
            {/* When the parent series is cancelled, this occurrence is in the
                past or has been left as a tombstone — disable mutation. */}
            <button
              className="buttonGhost buttonGhostDanger"
              onClick={() => (inSeries ? setScopeChoice("cancel") : handleDelete())}
              disabled={isPending || pickupPending || seriesCancelled}
            >
              {inSeries ? "Cancel booking" : "Delete"}
            </button>
            <button
              className="buttonGhost buttonNeutral"
              onClick={() => (inSeries ? setScopeChoice("edit") : handleSave(true))}
              disabled={isPending || pickupPending || seriesCancelled}
            >
              {inSeries ? "Edit booking" : isPending ? "Saving…" : "Save + email update"}
            </button>
            <button
              className="buttonPrimary"
              onClick={() => (inSeries ? setScopeChoice("edit") : handleSave(false))}
              disabled={isPending || pickupPending || seriesCancelled}
            >
              {isPending ? "Saving…" : "Save"}
            </button>
            <button className="buttonPickup" onClick={handlePickupReady} disabled={isPending || pickupPending || seriesCancelled}>
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
            <DateTimeField value={scheduledStart} onChange={setScheduledStart} />
          </EditItem>

          <EditItem label="Duration">
            {(() => {
              const totalMin = Number(durationMinutes) || 0;
              const d = Math.floor(totalMin / (24 * 60));
              const h = Math.floor((totalMin % (24 * 60)) / 60);
              const m = totalMin % 60;
              const update = (nd: number, nh: number, nm: number) => {
                const t = Math.max(0, nd) * 1440 + Math.max(0, nh) * 60 + Math.max(0, nm);
                setDurationMinutes(String(t));
              };
              return (
                <div className="durationRow">
                  <input
                    className="detailInput"
                    type="number"
                    min="0"
                    value={d || ""}
                    placeholder="0"
                    onChange={(e) => update(Number(e.target.value), h, m)}
                  />
                  <span className="durationUnit">d</span>
                  <input
                    className="detailInput"
                    type="number"
                    min="0"
                    max="23"
                    value={h || ""}
                    placeholder="0"
                    onChange={(e) => update(d, Number(e.target.value), m)}
                  />
                  <span className="durationUnit">h</span>
                  <input
                    className="detailInput"
                    type="number"
                    min="0"
                    max="59"
                    value={m || ""}
                    placeholder="0"
                    onChange={(e) => update(d, h, Number(e.target.value))}
                  />
                  <span className="durationUnit">m</span>
                  <span className="durationTotal">= {totalMin} min</span>
                </div>
              );
            })()}
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
            <select
              className="detailInput"
              value={locationType}
              onChange={(e) => setLocationType(e.target.value)}
            >
              <option value="">— Not set —</option>
              <option value="shop">Shop</option>
              <option value="mobile">Mobile</option>
            </select>
          </EditItem>

          {locationType === "mobile" && (
            <EditItem label="Mobile address">
              <input
                type="text"
                className="detailInput"
                value={serviceAddress}
                onChange={(e) => setServiceAddress(e.target.value)}
                placeholder="Street address where we'll meet the vehicle"
              />
            </EditItem>
          )}

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

      {/* ── Recurring-series scope modals ── */}
      {scopeChoice ? (
        <SeriesScopeChoiceModal
          action={scopeChoice}
          onClose={() => setScopeChoice(null)}
          onChoose={(scope, reason) => {
            const action = scopeChoice;
            setScopeChoice(null);
            if (scope === "single") {
              // Single-occurrence flow: existing per-booking endpoint (which
              // auto-flips series_overridden = true on the booking).
              if (action === "cancel") {
                if (!window.confirm("Cancel this booking only? Future occurrences in the series stay.")) return;
                setErrorMessage("");
                startTransition(async () => {
                  const res = await fetch(`/api/bookings/${booking.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "cancelled" }),
                  });
                  if (!res.ok) { setErrorMessage("Failed to cancel."); return; }
                  setStatus("cancelled");
                  router.refresh();
                });
              } else {
                // Inline save with whatever's already in the form.
                handleSave(false);
              }
            } else {
              // Series-wide flow.
              if (action === "cancel") {
                if (!booking.series_id) return;
                setErrorMessage("");
                startTransition(async () => {
                  const res = await fetch(`/api/booking-series/${booking.series_id}/cancel`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ scope: "series", reason: reason ?? null }),
                  });
                  const data = (await res.json()) as { ok?: boolean; error?: string; bookingsCancelled?: number };
                  if (!res.ok || !data.ok) {
                    setErrorMessage(data.error ?? "Failed to cancel series.");
                    return;
                  }
                  setSeriesBanner(`Series cancelled — ${data.bookingsCancelled ?? 0} future booking${(data.bookingsCancelled ?? 0) === 1 ? "" : "s"} cancelled.`);
                  router.refresh();
                });
              } else {
                setSeriesEditOpen(true);
              }
            }
          }}
        />
      ) : null}

      {seriesEditOpen ? (
        <SeriesEditFormModal
          booking={booking}
          onClose={() => setSeriesEditOpen(false)}
          onSaved={(count) => {
            setSeriesEditOpen(false);
            setSeriesBanner(`Series updated — ${count} future booking${count === 1 ? "" : "s"} synced.`);
            router.refresh();
          }}
        />
      ) : null}

    </section>
  );
}
