"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Modern split date + time picker that replaces the native
 * <input type="datetime-local"> (whose browser popover looks dated and
 * inconsistent across platforms).
 *
 * Contract matches datetime-local: `value` / `onChange` speak
 * "yyyy-MM-ddTHH:mm" wall-clock strings, so existing state and the
 * fromZonedTime(…, SHOP_TZ) conversion on submit stay untouched.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function parseValue(value: string): { date: string; time: string } {
  const [d, t] = (value || "").split("T");
  return { date: d || "", time: (t || "").slice(0, 5) };
}

function formatDateLabel(iso: string): string {
  if (!iso) return "Pick a date";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function format12h(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${pad(m)} ${ap}`;
}

// 15-min slots across working hours. Anything outside (rare) still
// renders because the current value is injected into the list.
function buildTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 6; h <= 20; h += 1) {
    for (let m = 0; m < 60; m += 15) {
      slots.push(`${pad(h)}:${pad(m)}`);
    }
  }
  return slots;
}

const TIME_SLOTS = buildTimeSlots();

export function DateTimeField({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
}) {
  const { date, time } = parseValue(value);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Month shown in the popover - follows the selected date, defaults to
  // the current month.
  const now = new Date();
  const [viewYear, setViewYear] = useState(() => (date ? Number(date.slice(0, 4)) : now.getFullYear()));
  const [viewMonth, setViewMonth] = useState(() => (date ? Number(date.slice(5, 7)) - 1 : now.getMonth()));

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const setDate = (iso: string) => {
    onChange(`${iso}T${time || "08:00"}`);
    setOpen(false);
  };

  const setTime = (t: string) => {
    onChange(`${date || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`}T${t}`);
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  // Build the 6x7 grid for the viewed month.
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const cells: Array<{ iso: string; day: number } | null> = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push({ iso: `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`, day: d });
  }

  const timeOptions = time && !TIME_SLOTS.includes(time)
    ? [...TIME_SLOTS, time].sort()
    : TIME_SLOTS;

  return (
    <div className="dtField" ref={wrapRef}>
      <button
        type="button"
        className={`dtDateButton${date ? "" : " dtDateButton--empty"}`}
        onClick={() => {
          if (!open && date) {
            setViewYear(Number(date.slice(0, 4)));
            setViewMonth(Number(date.slice(5, 7)) - 1);
          }
          setOpen(!open);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg className="dtIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M1.5 6h13" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {formatDateLabel(date)}
      </button>

      <select
        className="dtTimeSelect"
        value={time || ""}
        onChange={(e) => setTime(e.target.value)}
        required={required}
        aria-label="Time"
      >
        {!time ? <option value="" disabled>Time</option> : null}
        {timeOptions.map((t) => (
          <option key={t} value={t}>{format12h(t)}</option>
        ))}
      </select>

      {open ? (
        <div className="dtPopover" role="dialog" aria-label="Choose date">
          <div className="dtPopoverHeader">
            <button type="button" className="dtNavBtn" onClick={prevMonth} aria-label="Previous month">‹</button>
            <span className="dtPopoverTitle">{MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" className="dtNavBtn" onClick={nextMonth} aria-label="Next month">›</button>
          </div>
          <div className="dtDowRow">
            {DOW.map((d) => <span key={d}>{d}</span>)}
          </div>
          <div className="dtGrid">
            {cells.map((cell, i) =>
              cell ? (
                <button
                  key={cell.iso}
                  type="button"
                  className={[
                    "dtDay",
                    cell.iso === date ? "dtDay--selected" : "",
                    cell.iso === todayIso ? "dtDay--today" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => setDate(cell.iso)}
                >
                  {cell.day}
                </button>
              ) : (
                <span key={`pad-${i}`} />
              )
            )}
          </div>
          <div className="dtPopoverFooter">
            <button type="button" className="dtTodayBtn" onClick={() => setDate(todayIso)}>Today</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
