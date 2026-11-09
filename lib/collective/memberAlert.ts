/**
 * "This customer is a Collective member" alert.
 *
 * Max (9 Nov 2026): when a member books, staff need to see straight away
 * what subscription they're on and how many washes they've had this year.
 * Shown as a big banner on the booking page and at the top of the team
 * booking-notification email, and as a badge on the calendar.
 *
 * A customer can have several contact rows (one per shop, duplicates from
 * imports), so membership and bookings are matched across every contact
 * that shares the email address - same rule the /account portal uses.
 */

import { formatInTimeZone } from "date-fns-tz";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type MemberAlert = {
  status: "active" | "past_due" | "pending";
  sizeTier: string;
  monthlyFeeCents: number;
  monthlyCreditCents: number;
  startedAt: string | null;
  /** Credit balance across the customer's contacts, cents. */
  creditBalanceCents: number;
  year: string;
  /** Non-cancelled bookings this calendar year that started before now. */
  doneThisYear: number;
  /** Non-cancelled bookings later this year (incl. this one if upcoming). */
  bookedThisYear: number;
  /** Most recent past bookings this year, newest first. */
  recent: { date: string; service: string }[];
};

const LIVE_STATUSES = ["active", "past_due"];

/** Contact ids that belong to the same person (same email), incl. the given one. */
async function relatedContactIds(contactId: string): Promise<string[]> {
  const supabase = getSupabaseAdminClient();
  const { data: contact } = await supabase.from("contacts").select("id, email").eq("id", contactId).maybeSingle();
  const email = (contact?.email as string | null | undefined)?.trim();
  if (!email) return [contactId];
  const { data } = await supabase.from("contacts").select("id").ilike("email", email);
  const ids = new Set<string>([contactId, ...((data ?? []) as { id: string }[]).map((r) => r.id)]);
  return [...ids];
}

/**
 * Member alert for a booking's contact, or null when they aren't a paying
 * member (no membership, cancelled, or signed up but never paid).
 */
export async function getMemberAlert(contactId: string | null | undefined, timezone = "Pacific/Auckland"): Promise<MemberAlert | null> {
  if (!contactId) return null;
  try {
    const supabase = getSupabaseAdminClient();
    const contactIds = await relatedContactIds(contactId);

    const { data: memberships } = await supabase
      .from("memberships")
      .select("status, size_tier, monthly_fee_cents, monthly_credit_cents, started_at, created_at")
      .in("contact_id", contactIds)
      .in("status", LIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1);
    const m = (memberships ?? [])[0] as
      | { status: MemberAlert["status"]; size_tier: string; monthly_fee_cents: number; monthly_credit_cents: number; started_at: string | null }
      | undefined;
    if (!m) return null;

    const now = new Date();
    const year = formatInTimeZone(now, timezone, "yyyy");
    // Fetch a little either side of the year, then bucket in the shop's
    // timezone so a 1 Jan 9am NZ booking (31 Dec UTC) counts for the new year.
    const from = `${Number(year) - 1}-12-30T00:00:00Z`;
    const to = `${Number(year) + 1}-01-02T00:00:00Z`;

    const [{ data: bookings }, { data: ledger }] = await Promise.all([
      supabase
        .from("bookings")
        .select("service_name, scheduled_start, status")
        .in("contact_id", contactIds)
        .neq("status", "cancelled")
        .gte("scheduled_start", from)
        .lt("scheduled_start", to)
        .order("scheduled_start", { ascending: false }),
      supabase.from("credit_ledger").select("delta_cents").in("contact_id", contactIds),
    ]);

    const thisYear = ((bookings ?? []) as { service_name: string; scheduled_start: string; status: string }[]).filter(
      (b) => formatInTimeZone(new Date(b.scheduled_start), timezone, "yyyy") === year
    );
    const past = thisYear.filter((b) => new Date(b.scheduled_start) <= now);
    const ahead = thisYear.length - past.length;

    return {
      status: m.status,
      sizeTier: m.size_tier,
      monthlyFeeCents: m.monthly_fee_cents,
      monthlyCreditCents: m.monthly_credit_cents,
      startedAt: m.started_at,
      creditBalanceCents: ((ledger ?? []) as { delta_cents: number }[]).reduce((s, r) => s + (r.delta_cents ?? 0), 0),
      year,
      doneThisYear: past.length,
      bookedThisYear: ahead,
      recent: past.slice(0, 5).map((b) => ({
        date: formatInTimeZone(new Date(b.scheduled_start), timezone, "d MMM"),
        service: b.service_name,
      })),
    };
  } catch (err) {
    // Never block a booking page or a team email on this lookup.
    console.error("getMemberAlert failed", { contactId, err });
    return null;
  }
}

/** Contact ids (incl. same-email duplicates) of every paying member. Used for calendar badges. */
export async function getMemberContactIds(): Promise<string[]> {
  try {
    const supabase = getSupabaseAdminClient();
    const { data: memberships } = await supabase.from("memberships").select("contact_id").in("status", LIVE_STATUSES);
    const direct = ((memberships ?? []) as { contact_id: string }[]).map((r) => r.contact_id);
    if (direct.length === 0) return [];
    const { data: contacts } = await supabase.from("contacts").select("email").in("id", direct);
    const emails = [...new Set(((contacts ?? []) as { email: string | null }[]).map((c) => c.email?.trim().toLowerCase()).filter(Boolean))] as string[];
    const ids = new Set(direct);
    for (const email of emails) {
      const { data } = await supabase.from("contacts").select("id").ilike("email", email);
      for (const r of (data ?? []) as { id: string }[]) ids.add(r.id);
    }
    return [...ids];
  } catch (err) {
    console.error("getMemberContactIds failed", err);
    return [];
  }
}

const money = (cents: number) =>
  new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 }).format(cents / 100);

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const STATUS_LABEL: Record<MemberAlert["status"], string> = {
  active: "Active",
  past_due: "PAYMENT PAST DUE",
  pending: "Not paid",
};

/** Plain lines shared by the email (text + html) versions. */
export function memberAlertLines(a: MemberAlert, bookingIsPast: boolean) {
  const nth = bookingIsPast ? null : a.doneThisYear + 1;
  return {
    headline: "COLLECTIVE MEMBER",
    plan: `${a.sizeTier} plan · ${money(a.monthlyFeeCents)}/mo + GST → ${money(a.monthlyCreditCents)} credit/mo`,
    status: STATUS_LABEL[a.status],
    credit: `Credit balance: ${money(a.creditBalanceCents)}`,
    washes: `Washes in ${a.year}: ${a.doneThisYear} done${a.bookedThisYear ? `, ${a.bookedThisYear} booked ahead` : ""}${nth ? ` (this booking is their ${ordinal(nth)})` : ""}`,
    recent: a.recent.length ? `Recent: ${a.recent.map((r) => `${r.date} ${r.service}`).join(" · ")}` : "No washes yet this year",
    since: a.startedAt ? `Member since ${a.startedAt.slice(0, 10)}` : null,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Big block for the top of the team booking email. */
export function memberAlertEmail(a: MemberAlert, bookingIsPast: boolean) {
  const l = memberAlertLines(a, bookingIsPast);
  const pastDue = a.status === "past_due";
  const html = `<div style="background:${pastDue ? "#991b1b" : "#14532d"};color:#ffffff;padding:20px 22px;border-radius:10px;margin:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;">
<div style="font-size:26px;font-weight:800;letter-spacing:1px;margin:0 0 8px 0;">⚠️ ${l.headline}</div>
<div style="font-size:18px;font-weight:700;margin:0 0 6px 0;">${esc(l.plan)}</div>
<div style="font-size:18px;font-weight:700;margin:0 0 6px 0;">${esc(l.washes)}</div>
<div style="font-size:15px;margin:0 0 4px 0;">Status: <b>${esc(l.status)}</b> · ${esc(l.credit)}${l.since ? ` · ${esc(l.since)}` : ""}</div>
<div style="font-size:14px;opacity:.9;">${esc(l.recent)}</div>
</div>`;
  const text = [`*** ${l.headline} ***`, l.plan, l.washes, `Status: ${l.status} · ${l.credit}`, l.recent, ""].join("\n");
  return { subjectPrefix: "⚠️ COLLECTIVE MEMBER - ", html, text };
}
