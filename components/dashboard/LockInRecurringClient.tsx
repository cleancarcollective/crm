"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { formatCurrency } from "@/lib/dashboard/format";
import {
  fetchAvailableDates,
  fetchTimeSlots,
  formatDatePillLabel,
  formatTimeLabel,
  type LocationKind,
  type TimeSlot,
} from "@/lib/customer/availability";

type CadenceMonths = 1 | 3 | 6;

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
  duration_minutes: number;
  location_type: "in-store" | "mobile";
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

type DateEntry = {
  date: Date;
  ymd: string;
  hasAvailability: boolean;
  isSunday: boolean;
  dayOffset: number;
};

const INITIAL_DAYS_VISIBLE = 28;
const EXPANDED_DAYS_VISIBLE = 60;
// How many days before the natural cadence target to start fetching pills.
// Customers usually want to keep the cadence; letting them go ~2 weeks
// earlier gives flexibility without anchoring at "tomorrow".
const PRE_TARGET_DAYS = 14;

function cadenceLabel(months: CadenceMonths): string {
  return months === 1 ? "Every month" : `Every ${months} months`;
}

function locationToKind(loc: "in-store" | "mobile"): LocationKind {
  return loc === "mobile" ? "mobile" : "shop";
}

/**
 * Natural target day offset from today for a given cadence. Approximation:
 * 30 days per month - good enough for "show dates roughly N months out".
 */
function cadenceTargetDayOffset(months: CadenceMonths): number {
  return months * 30;
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

  // Availability state.
  const [dates, setDates] = useState<DateEntry[]>([]);
  const [datesLoading, setDatesLoading] = useState(true);
  const [datesFailed, setDatesFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsFailed, setSlotsFailed] = useState(false);

  const locationKind = locationToKind(booking.location_type);
  const duration = booking.duration_minutes;

  // Fetch only the window the customer is about to see. Each upstream
  // window is ~2-3s; fetching all 150 days up-front was making the page
  // wait 8-10s before the date strip appeared. Re-fetch when cadence
  // changes (or when the user expands the visible range).
  useEffect(() => {
    let cancelled = false;
    const target = cadenceTargetDayOffset(cadence);
    const span = expanded ? EXPANDED_DAYS_VISIBLE : INITIAL_DAYS_VISIBLE;
    const halfSpan = Math.floor(span / 2);
    // Anchored window: pre-target buffer + span beyond target. Plus a
    // small forward buffer so customers can scroll forward without
    // hitting a wall.
    const startOffset = Math.max(0, target - (expanded ? halfSpan : PRE_TARGET_DAYS));
    const fetchHorizon = (expanded ? halfSpan : PRE_TARGET_DAYS) + span;

    setDatesLoading(true);
    setDatesFailed(false);
    fetchAvailableDates(shop.slug, locationKind, duration, fetchHorizon, startOffset)
      .then((result) => {
        if (cancelled) return;
        setDates(result);
        setDatesLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDatesFailed(true);
        setDatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.slug, locationKind, duration, cadence, expanded]);

  // Whenever cadence changes (or dates load), auto-pick the soonest viable
  // date AT OR AFTER the natural cadence target. Customer gets dates that
  // match what they signed up for ("every 2 months" defaults to ~2 months
  // out, not tomorrow). Uses absolute dayOffset (not array index) since
  // the fetched window now starts at the cadence anchor, not at today.
  useEffect(() => {
    if (dates.length === 0) return;
    const target = cadenceTargetDayOffset(cadence);
    const current = dates.find((d) => d.ymd === startDate);
    const currentViable = current
      && current.dayOffset >= target
      && current.hasAvailability
      && !current.isSunday;
    if (currentViable) return;
    const fromTarget = dates.find(
      (d) => d.dayOffset >= target && d.hasAvailability && !d.isSunday,
    );
    const fallback = dates.find((d) => d.hasAvailability && !d.isSunday);
    const picked = fromTarget ?? fallback;
    if (picked) {
      setStartDate(picked.ymd);
      setStartTime("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, cadence]);

  // Fetch time slots whenever the chosen date changes (and we have live data).
  useEffect(() => {
    if (datesFailed) return;
    if (!startDate) return;
    const picked = dates.find((d) => d.ymd === startDate);
    if (!picked) return;
    let cancelled = false;
    setSlotsLoading(true);
    setSlotsFailed(false);
    fetchTimeSlots(picked.date, shop.slug, locationKind, duration)
      .then((result) => {
        if (cancelled) return;
        setSlots(result);
        setSlotsLoading(false);
        // Auto-select an available slot if the current one isn't valid.
        const current = result.find((s) => s.time === startTime && s.available);
        if (!current) {
          const first = result.find((s) => s.available);
          setStartTime(first ? first.time : "");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSlotsFailed(true);
        setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, dates, datesFailed, shop.slug, locationKind, duration]);

  const chosenOption = cadenceOptions.find((c) => c.months === cadence) ?? cadenceOptions[0];

  // The fetched window is already anchored to the cadence target, so the
  // returned array IS the visible strip. No more slicing needed.
  const visibleDates = dates;

  const availableSlots = useMemo(() => slots.filter((s) => s.available), [slots]);

  const stripRef = useRef<HTMLDivElement>(null);
  const scrollStrip = useCallback((direction: -1 | 1) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  }, []);

  const useLiveAvailability = !datesFailed;

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
      const data = (await res.json().catch(() => ({}))) as { error?: string };
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

          {useLiveAvailability ? (
            <>
              {datesLoading ? (
                <p className="lockInPickerLoading">Loading availability…</p>
              ) : (
                <>
                  <div className="lockInDateStripWrap">
                    <button
                      type="button"
                      className="lockInStripNav"
                      aria-label="Scroll dates left"
                      onClick={() => scrollStrip(-1)}
                    >
                      ‹
                    </button>
                    <div className="lockInDateStrip" ref={stripRef}>
                      {visibleDates.map((d) => {
                        const disabled = d.isSunday || !d.hasAvailability;
                        const selected = d.ymd === startDate;
                        const label = formatDatePillLabel(d.date);
                        return (
                          <button
                            type="button"
                            key={d.ymd}
                            disabled={disabled}
                            onClick={() => {
                              setStartDate(d.ymd);
                              setStartTime("");
                            }}
                            className={
                              "lockInDatePill" +
                              (selected ? " lockInDatePill--selected" : "") +
                              (disabled ? " lockInDatePill--disabled" : "")
                            }
                          >
                            <span className="lockInDatePillWeekday">{label.weekday}</span>
                            <span className="lockInDatePillDay">{label.day}</span>
                            <span className="lockInDatePillMonth">{label.month}</span>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className="lockInStripNav"
                      aria-label="Scroll dates right"
                      onClick={() => scrollStrip(1)}
                    >
                      ›
                    </button>
                  </div>
                  {!expanded && dates.length > INITIAL_DAYS_VISIBLE ? (
                    <button
                      type="button"
                      className="lockInMoreDatesBtn"
                      onClick={() => setExpanded(true)}
                    >
                      Show more dates
                    </button>
                  ) : null}
                </>
              )}

              <h3 style={{ marginTop: 16 }}>Pick a time</h3>
              {slotsLoading ? (
                <p className="lockInPickerLoading">Loading times…</p>
              ) : slotsFailed ? (
                <p className="lockInPickerNotice">
                  Couldn&apos;t load times for that day. Pick another date or we&apos;ll confirm by email.
                </p>
              ) : availableSlots.length === 0 ? (
                <p className="lockInPickerNotice">
                  No open times on that day — pick another date.
                </p>
              ) : (
                <>
                  <div className="lockInSlotGrid">
                    {availableSlots.map((s) => {
                      const selected = s.time === startTime;
                      return (
                        <button
                          type="button"
                          key={s.time}
                          onClick={() => setStartTime(s.time)}
                          className={
                            "lockInSlotPill" + (selected ? " lockInSlotPill--selected" : "")
                          }
                        >
                          {formatTimeLabel(s.time)}
                        </button>
                      );
                    })}
                  </div>
                  {/* Overnight warning - matches the booking form summary
                      step. Shop closes at 5pm; if the picked start + service
                      duration runs past close, we keep the vehicle overnight.
                      The series is still bookable - this is a heads-up, not
                      a block. */}
                  {(() => {
                    if (!startTime) return null;
                    const [sh, sm] = startTime.split(":").map(Number);
                    const startMins = (sh ?? 0) * 60 + (sm ?? 0);
                    const endMins = startMins + duration;
                    const closeMins = 17 * 60;
                    if (endMins <= closeMins) return null;
                    return (
                      <p className="lockInOvernightNotice">
                        ⚠ Heads up: this is a long service. Starting at {formatTimeLabel(startTime)} means we&apos;ll likely need to keep the vehicle overnight. We&apos;ll confirm pickup time when we send your reminder.
                      </p>
                    );
                  })()}
                </>
              )}
            </>
          ) : (
            <>
              <p className="lockInPickerNotice">
                Couldn&apos;t load live availability — pick any date/time and we&apos;ll confirm by email.
              </p>
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
            </>
          )}

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
