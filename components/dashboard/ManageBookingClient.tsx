"use client";

import { useState, useTransition } from "react";

type BookingDetails = {
  id: string;
  series_id: string | null;
  service_name: string;
  scheduled_start: string;
  scheduled_end: string | null;
  duration_minutes: number | null;
  location_type: string | null;
  status: string;
  scheduled_label: string;
};

type ShopRef = { name: string; slug: string };

type Props = {
  token: string;
  booking: BookingDetails;
  shop: ShopRef;
  firstName: string;
};

type Mode = "view" | "reschedule" | "cancel" | "done_reschedule" | "done_cancel" | "error";

export function ManageBookingClient({ token, booking, shop, firstName }: Props) {
  const [mode, setMode] = useState<Mode>("view");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isPending, startTransition] = useTransition();
  // Cancel scope — only shown when the booking is part of a recurring series.
  const [cancelScope, setCancelScope] = useState<"one" | "series">("one");
  const isRecurring = !!booking.series_id;

  function handleReschedule(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    if (!date || !time) {
      setErrorMsg("Pick a date and time.");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/public/booking-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action: "reschedule",
          new_date: date,
          new_time: time,
          reason: reason || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMode("done_reschedule");
      } else {
        setErrorMsg(data.error ?? "Failed to submit reschedule request.");
      }
    });
  }

  function handleCancel() {
    const isWholeSeries = isRecurring && cancelScope === "series";
    const confirmMsg = isWholeSeries
      ? "Cancel ALL upcoming visits in this recurring booking? This can't be undone."
      : "Cancel this booking? This can't be undone.";
    if (!confirm(confirmMsg)) return;
    setErrorMsg("");
    startTransition(async () => {
      const res = await fetch("/api/public/booking-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action: "cancel",
          reason: reason || null,
          scope: isWholeSeries ? "series" : "one",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMode("done_cancel");
      } else {
        setErrorMsg(data.error ?? "Failed to cancel.");
      }
    });
  }

  if (mode === "done_reschedule") {
    return (
      <main className="leadActionShell">
        <div className="leadActionCard leadActionCard--ok">
          <div className="leadActionEmoji">✅</div>
          <h1>Reschedule request received</h1>
          <p>Thanks {firstName}, we'll review your request and get back to you within a few hours to confirm the new time. You'll get an email when it's locked in.</p>
        </div>
      </main>
    );
  }

  if (mode === "done_cancel") {
    const wasSeries = isRecurring && cancelScope === "series";
    return (
      <main className="leadActionShell">
        <div className="leadActionCard leadActionCard--ok">
          <div className="leadActionEmoji">✅</div>
          <h1>{wasSeries ? "Recurring booking cancelled" : "Booking cancelled"}</h1>
          <p>
            {wasSeries
              ? `Sorry to see you go, ${firstName}. All your upcoming visits have been cancelled. If you change your mind, just reply to your original confirmation email or hit our website to rebook.`
              : `Sorry to see you go, ${firstName}. The slot is now free for someone else. If you change your mind, just reply to your original confirmation email or hit our website.`}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="leadActionShell">
      <div className="leadActionCard leadActionCard--info" style={{ textAlign: "left", maxWidth: 540 }}>
        <h1 style={{ textAlign: "center" }}>Hi {firstName} 👋</h1>
        <p style={{ textAlign: "center" }}>Here&apos;s your booking with <strong>{shop.name}</strong>.</p>

        <dl className="manageBookingGrid">
          <dt>Service</dt><dd>{booking.service_name}</dd>
          <dt>When</dt><dd>{booking.scheduled_label}</dd>
          {booking.location_type ? <><dt>Location</dt><dd>{booking.location_type}</dd></> : null}
          {booking.duration_minutes ? <><dt>Duration</dt><dd>{booking.duration_minutes} min</dd></> : null}
        </dl>

        {mode === "view" && (
          <div className="manageBookingActions">
            <button type="button" className="buttonPrimary" onClick={() => setMode("reschedule")}>
              Reschedule
            </button>
            <button type="button" className="buttonGhost" onClick={() => setMode("cancel")}>
              Cancel booking
            </button>
          </div>
        )}

        {mode === "reschedule" && (
          <form onSubmit={handleReschedule} className="manageBookingForm">
            <h3>Pick a new time</h3>
            <p className="manageBookingHint">
              We&apos;ll review your request and confirm by email — actual times depend on availability.
            </p>
            <label className="templateEditorField">
              <span className="templateEditorLabel">New date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="templateEditorInput" required />
            </label>
            <label className="templateEditorField">
              <span className="templateEditorLabel">Preferred time</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="templateEditorInput" required />
            </label>
            <label className="templateEditorField">
              <span className="templateEditorLabel">Anything else? (optional)</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="templateEditorTextarea" placeholder="e.g. flexible across the day, can do morning or afternoon" />
            </label>
            <div className="manageBookingActions">
              <button type="submit" className="buttonPrimary" disabled={isPending}>
                {isPending ? "Submitting…" : "Request reschedule"}
              </button>
              <button type="button" className="buttonGhost" onClick={() => setMode("view")}>
                Back
              </button>
            </div>
            {errorMsg && <p className="manageBookingError">{errorMsg}</p>}
          </form>
        )}

        {mode === "cancel" && (
          <form onSubmit={(e) => { e.preventDefault(); handleCancel(); }} className="manageBookingForm">
            <h3>{isRecurring ? "Cancel this booking?" : "Cancel this booking?"}</h3>

            {isRecurring && (
              <>
                <p className="manageBookingHint">
                  This visit is part of your recurring booking. Choose what you&apos;d like to cancel:
                </p>
                <div role="radiogroup" aria-label="Cancellation scope" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", padding: 12, border: `1px solid ${cancelScope === "one" ? "#1a4d2e" : "#e8e0d6"}`, borderRadius: 10, background: cancelScope === "one" ? "rgba(26,77,46,0.05)" : "#fff" }}>
                    <input
                      type="radio"
                      name="cancelScope"
                      value="one"
                      checked={cancelScope === "one"}
                      onChange={() => setCancelScope("one")}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <strong>Just this visit</strong>
                      <br />
                      <span style={{ fontSize: 13, color: "#7a6f68" }}>Cancel only your {booking.scheduled_label} appointment. Your other upcoming visits stay scheduled.</span>
                    </span>
                  </label>
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", padding: 12, border: `1px solid ${cancelScope === "series" ? "#b23434" : "#e8e0d6"}`, borderRadius: 10, background: cancelScope === "series" ? "rgba(178,52,52,0.05)" : "#fff" }}>
                    <input
                      type="radio"
                      name="cancelScope"
                      value="series"
                      checked={cancelScope === "series"}
                      onChange={() => setCancelScope("series")}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <strong>Cancel the whole recurring booking</strong>
                      <br />
                      <span style={{ fontSize: 13, color: "#7a6f68" }}>End the recurring schedule. All your upcoming visits will be cancelled.</span>
                    </span>
                  </label>
                </div>
              </>
            )}

            {!isRecurring && (
              <p className="manageBookingHint">
                This frees up your slot. You can rebook anytime via our website or by replying to your confirmation email.
              </p>
            )}

            <label className="templateEditorField">
              <span className="templateEditorLabel">Reason (optional, helps us improve)</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="templateEditorTextarea" />
            </label>
            <div className="manageBookingActions">
              <button type="submit" className="buttonPrimary" disabled={isPending} style={{ background: "#b23434" }}>
                {isPending
                  ? "Cancelling…"
                  : isRecurring && cancelScope === "series"
                    ? "Yes, cancel recurring booking"
                    : "Yes, cancel booking"}
              </button>
              <button type="button" className="buttonGhost" onClick={() => setMode("view")}>
                Back
              </button>
            </div>
            {errorMsg && <p className="manageBookingError">{errorMsg}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
