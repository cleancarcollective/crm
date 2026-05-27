import { formatInTimeZone } from "date-fns-tz";

/**
 * Format an NZD amount. All prices in the system are stored ex-GST, so
 * by default we append " +GST" - this matches how the booking form
 * displays prices and what the sales rep needs to quote. Pass
 * `{ withGstLabel: false }` when rendering a value that's already been
 * GST-handled elsewhere (e.g. customer receipts where the line items
 * + GST line are shown separately).
 */
export function formatCurrency(amount: number | null, opts?: { withGstLabel?: boolean }) {
  if (amount === null) {
    return "-";
  }

  // Always show cents. Whole-dollar rounding misrepresented $99.75 as
  // "$100" on customer-facing booking emails - the difference matters
  // both for customer trust and our own internal numbers (revenue
  // rollups, analytics).
  const formatted = new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  return opts?.withGstLabel === false ? formatted : `${formatted} +GST`;
}

export function formatMinutes(totalMinutes: number) {
  if (totalMinutes <= 0) {
    return "0h";
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

export function formatDateTime(iso: string, timezone: string, formatString = "EEE d MMM, h:mm a") {
  return formatInTimeZone(iso, timezone, formatString);
}

export function formatMonthLabel(yearMonth: string, timezone: string) {
  return formatInTimeZone(`${yearMonth}-01T00:00:00Z`, timezone, "MMMM yyyy");
}
