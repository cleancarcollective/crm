"use client";

import { useState, useTransition } from "react";

import { formatCurrency } from "@/lib/dashboard/format";

type CadenceMonths = 2 | 3 | 4;

type CadenceOption = {
  months: CadenceMonths;
  discount: number;
  price: number | null;
};

type BookingSummary = {
  id: string;
  service_name: string;
  scheduled_label: string;
  vehicle_label: string;
  base_price: number | null;
};

type ShopRef = { name: string; slug: string };

type Props = {
  token: string;
  shop: ShopRef;
  firstName: string;
  booking: BookingSummary;
  initialCadence: CadenceMonths;
  cadenceOptions: CadenceOption[];
  defaultStartDate: string;
  defaultStartTime: string;
};

type Mode = "view" | "done" | "error";

function cadenceLabel(months: CadenceMonths): string {
  return `Every ${months} months`;
}

export function LockInRecurringClient({
  token,
  shop,
  firstName,
  booking,
  initialCadence,
  cadenceOptions,
  defaultStartDate,
  defaultStartTime,
}: Props) {
  const [mode, setMode] = useState<Mode>("view");
  const [cadence, setCadence] = useState<CadenceMonths>(initialCadence);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [errorMsg, setErrorMsg] = useState("");
  const [isPending, startTransition] = useTransition();

  const chosenOption = cadenceOptions.find((c) => c.months === cadence) ?? cadenceOptions[0];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    if (!startDate || !startTime) {
      setErrorMsg("Pick a start date and time.");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/public/lock-in-recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          cadence_months: cadence,
          start_date: startDate,
          start_time: startTime,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMode("done");
      } else {
        setErrorMsg(data.error ?? "Failed to lock in your recurring rate.");
      }
    });
  }

  if (mode === "done") {
    return (
      <main className="leadActionShell">
        <div className="leadActionCard leadActionCard--ok">
          <div className="leadActionEmoji">✅</div>
          <h1>Locked in!</h1>
          <p>
            Thanks {firstName} — you&apos;re now on {cadenceLabel(cadence).toLowerCase()} with {chosenOption.discount}% off every visit.
            We&apos;ll send confirmations and reminders ahead of each appointment. Cancel or pause anytime by replying to your confirmation email.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="leadActionShell">
      <div className="leadActionCard leadActionCard--info" style={{ textAlign: "left", maxWidth: 540 }}>
        <h1 style={{ textAlign: "center" }}>Hi {firstName} 👋</h1>
        <p style={{ textAlign: "center" }}>
          Lock in a recurring detail with <strong>{shop.name}</strong> and save on every visit.
        </p>

        <dl className="manageBookingGrid">
          <dt>Your last detail</dt><dd>{booking.service_name}</dd>
          <dt>When</dt><dd>{booking.scheduled_label}</dd>
          <dt>Vehicle</dt><dd>{booking.vehicle_label}</dd>
          {booking.base_price != null ? (
            <>
              <dt>Per visit</dt><dd>{formatCurrency(booking.base_price)}</dd>
            </>
          ) : null}
        </dl>

        <form onSubmit={handleSubmit} className="manageBookingForm">
          <h3>Pick your cadence</h3>
          <div role="radiogroup" aria-label="Recurring cadence" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            {cadenceOptions.map((opt) => {
              const selected = opt.months === cadence;
              const priceLine = opt.price != null
                ? `${formatCurrency(opt.price)} per visit`
                : null;
              return (
                <label
                  key={opt.months}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    cursor: "pointer",
                    padding: 12,
                    border: `1px solid ${selected ? "#1a4d2e" : "#e8e0d6"}`,
                    borderRadius: 10,
                    background: selected ? "rgba(26,77,46,0.05)" : "#fff",
                  }}
                >
                  <input
                    type="radio"
                    name="cadence"
                    value={opt.months}
                    checked={selected}
                    onChange={() => setCadence(opt.months)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <strong>{cadenceLabel(opt.months)} — save {opt.discount}%</strong>
                    {priceLine ? (
                      <>
                        <br />
                        <span style={{ fontSize: 13, color: "#7a6f68" }}>{priceLine}</span>
                      </>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>

          <h3>Pick a start date</h3>
          <div className="lockInDateTimeGrid">
            <label className="lockInDateTimeField">
              <span className="lockInDateTimeLabel">First visit</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="lockInDateTimeInput"
                required
              />
              <span className="lockInDateTimeHint">Tap to change</span>
            </label>
            <label className="lockInDateTimeField">
              <span className="lockInDateTimeLabel">Time</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="lockInDateTimeInput"
                required
              />
              <span className="lockInDateTimeHint">Tap to change</span>
            </label>
          </div>

          <div className="manageBookingActions">
            <button type="submit" className="buttonPrimary" disabled={isPending}>
              {isPending ? "Locking in…" : "Lock it in →"}
            </button>
          </div>
          {errorMsg && <p className="manageBookingError">{errorMsg}</p>}

          <p className="manageBookingHint" style={{ marginTop: 12 }}>
            Cancel or pause anytime. We&apos;ll send reminders before each visit.
          </p>
        </form>
      </div>
    </main>
  );
}
