/**
 * Public customer-facing availability helper.
 *
 * Wraps the /api/public/availability proxy (which fans out to per-shop Google
 * Apps Script calendar readers). Used by customer-facing client components
 * like the lock-in-recurring page to render date pills + time slot grids.
 *
 * Mirrors the booking-form repo's services/schedulingService.ts but trimmed
 * for in-CRM use: no 14-day pagination UI, just one bigger window covering
 * ~60 days forward. Same operating hours (8:30 -> 17:00, 30-min granularity)
 * and Pacific/Auckland timezone semantics.
 */
"use client";

export type LocationKind = "shop" | "mobile";

export type BusyBlock = { start: string; end: string; allDay?: boolean };

export type TimeSlot = { time: string; available: boolean };

const AVAILABILITY_URL = "/api/public/availability";

// /api/public/availability enforces MAX_DAYS = 21 per call, so we fetch
// multiple windows in parallel to cover 60+ days.
const WINDOW_DAYS = 21;
const DEFAULT_HORIZON_DAYS = 60;
const CACHE_TTL_MS = 60 * 1000;

const OPERATING_START_HOUR = 8.5; // 08:30
const OPERATING_END_HOUR = 17; // 17:00

type CachedBundle = {
  fetchedAtMs: number;
  busyByDate: Record<string, BusyBlock[]>;
};

const bundleCache: Record<string, CachedBundle> = {};
const inflight: Record<string, Promise<CachedBundle>> = {};

export function getAucklandDate(date: Date = new Date()): Date {
  return new Date(date.toLocaleString("en-US", { timeZone: "Pacific/Auckland" }));
}

export function dateToYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

async function loadWindow(
  shopSlug: string,
  locationType: LocationKind,
  startYmd: string,
  days: number,
): Promise<CachedBundle> {
  const key = `${shopSlug}|${locationType}|${startYmd}|${days}`;
  const cached = bundleCache[key];
  if (cached && Date.now() - cached.fetchedAtMs < CACHE_TTL_MS) return cached;
  const existing = inflight[key];
  if (existing) return existing;

  const promise = (async () => {
    const params = new URLSearchParams({
      shop: shopSlug,
      type: locationType,
      days: String(days),
      start: startYmd,
    });
    const res = await fetch(`${AVAILABILITY_URL}?${params.toString()}`);
    if (!res.ok) throw new Error(`Availability fetch ${res.status}`);
    const json = (await res.json()) as { busyByDate?: Record<string, BusyBlock[]> };
    const bundle: CachedBundle = {
      fetchedAtMs: Date.now(),
      busyByDate: json.busyByDate ?? {},
    };
    bundleCache[key] = bundle;
    return bundle;
  })();

  inflight[key] = promise;
  try {
    return await promise;
  } finally {
    delete inflight[key];
  }
}

function buildPossibleSlots(): string[] {
  const slots: string[] = ["08:30"];
  for (let h = 9; h < OPERATING_END_HOUR; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  // Skip the 17:00 slot itself (matches booking form behaviour: last start is 16:30)
  void OPERATING_START_HOUR;
  return slots;
}

function computeSlotsForDate(
  date: Date,
  busy: BusyBlock[],
  durationMinutes: number,
): TimeSlot[] {
  const possible = buildPossibleSlots();
  const nowAk = getAucklandDate();
  return possible.map((time) => {
    const [hh, mm] = time.split(":").map(Number);
    const slotStart = new Date(date);
    slotStart.setHours(hh ?? 0, mm ?? 0, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);
    const isBusy = busy.some((block) => {
      if (block.allDay) return true;
      const bStart = new Date(block.start);
      const bEnd = new Date(block.end);
      return slotStart < bEnd && slotEnd > bStart;
    });
    const isPast = slotStart < nowAk;
    return { time, available: !isBusy && !isPast };
  });
}

/**
 * Returns the next `horizonDays` candidate dates (in Auckland local time)
 * with availability metadata. Sundays and fully-busy days are flagged as
 * unavailable. Past dates are dropped entirely.
 */
export async function fetchAvailableDates(
  shopSlug: string,
  locationType: LocationKind,
  durationMinutes: number,
  horizonDays: number = DEFAULT_HORIZON_DAYS,
): Promise<Array<{ date: Date; ymd: string; hasAvailability: boolean; isSunday: boolean }>> {
  const today = getAucklandDate();
  today.setHours(0, 0, 0, 0);

  // Fan out window fetches in parallel.
  const windowCount = Math.ceil(horizonDays / WINDOW_DAYS);
  const windowPromises: Promise<CachedBundle | null>[] = [];
  for (let i = 0; i < windowCount; i++) {
    const ws = addDays(today, i * WINDOW_DAYS);
    const remaining = Math.min(WINDOW_DAYS, horizonDays - i * WINDOW_DAYS);
    windowPromises.push(
      loadWindow(shopSlug, locationType, dateToYmd(ws), remaining).catch(() => null),
    );
  }
  const windows = await Promise.all(windowPromises);

  // Merge into one map.
  const busyByDate: Record<string, BusyBlock[]> = {};
  let anyOk = false;
  for (const w of windows) {
    if (!w) continue;
    anyOk = true;
    for (const [k, v] of Object.entries(w.busyByDate)) busyByDate[k] = v;
  }
  if (!anyOk) throw new Error("All availability windows failed");

  const out: Array<{ date: Date; ymd: string; hasAvailability: boolean; isSunday: boolean }> = [];
  for (let i = 0; i < horizonDays; i++) {
    const d = addDays(today, i);
    const ymd = dateToYmd(d);
    const isSunday = d.getDay() === 0;
    if (isSunday) {
      out.push({ date: d, ymd, hasAvailability: false, isSunday: true });
      continue;
    }
    const slots = computeSlotsForDate(d, busyByDate[ymd] ?? [], durationMinutes);
    out.push({
      date: d,
      ymd,
      hasAvailability: slots.some((s) => s.available),
      isSunday: false,
    });
  }
  return out;
}

/**
 * Returns 30-min start slots for a specific date. Slots that conflict with
 * busy blocks (or are in the past) get available=false.
 */
export async function fetchTimeSlots(
  date: Date,
  shopSlug: string,
  locationType: LocationKind,
  durationMinutes: number,
): Promise<TimeSlot[]> {
  if (date.getDay() === 0) return [];

  const today = getAucklandDate();
  today.setHours(0, 0, 0, 0);
  const dayDiff = Math.floor((date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  const windowIndex = Math.max(0, Math.floor(dayDiff / WINDOW_DAYS));
  const windowStart = addDays(today, windowIndex * WINDOW_DAYS);

  const bundle = await loadWindow(
    shopSlug,
    locationType,
    dateToYmd(windowStart),
    WINDOW_DAYS,
  );
  const busy = bundle.busyByDate[dateToYmd(date)] ?? [];
  return computeSlotsForDate(date, busy, durationMinutes);
}

export function formatTimeLabel(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function formatDatePillLabel(date: Date): { weekday: string; day: string; month: string } {
  return {
    weekday: date.toLocaleDateString("en-NZ", { weekday: "short" }),
    day: String(date.getDate()),
    month: date.toLocaleDateString("en-NZ", { month: "short" }),
  };
}
