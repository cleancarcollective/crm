/**
 * Per-lead conversion audit. Run with:
 *   npx tsx scripts/audit-conversions.ts
 *
 * For every lead in the last 90 days, lists exactly which booking (if any)
 * we credited it with — so you can eyeball the attribution and trust the
 * conversion-rate report. Writes Markdown to
 * reports/conversion-audit-<date>.md.
 *
 * Each row tells you:
 *   - When the lead came in (and from which source)
 *   - Who the contact is (name + email)
 *   - Whether an email was sent and when
 *   - Whether a booking exists for that contact within the 30d window
 *   - Lag in days between lead and booking
 *   - Whether the contact had MULTIPLE leads (potential double-count)
 *   - Whether the booking happened (status = completed)
 *
 * Read-only. No emails sent. Safe to run anytime.
 */

import fs from "node:fs";
import path from "node:path";

import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

import { CONVERSION_WINDOW_DAYS } from "@/lib/email/sendWeeklyConversionReport";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const LOOKBACK_DAYS = 90;

type AuditRow = {
  shopName: string;
  leadId: string;
  leadCreatedAt: string;
  leadSource: string;
  contactId: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  vehicleLabel: string;
  serviceRequested: string | null;
  confirmationSentAt: string | null;
  quoteSentAt: string | null;
  quoteSubject: string | null;
  bookingId: string | null;
  bookingCreatedAt: string | null;
  bookingStatus: string | null;
  bookingPrice: number | null;
  bookingScheduledStart: string | null;
  lagDays: number | null;
  withinWindow: boolean;
  contactLeadCount: number;
  flag: string;
};

function fmtDate(iso: string | null, tz: string) {
  if (!iso) return "—";
  return formatInTimeZone(iso, tz, "d MMM HH:mm");
}

function fmtNzd(n: number | null) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 }).format(n);
}

async function main() {
  const supabase = getSupabaseAdminClient();
  const cutoffIso = addDays(new Date(), -LOOKBACK_DAYS).toISOString();
  const conversionMs = CONVERSION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const { data: shops } = await supabase
    .from("shops")
    .select("id, slug, name, timezone")
    .order("slug");
  if (!shops) throw new Error("No shops");

  const allRows: AuditRow[] = [];
  const summary: Record<
    string,
    { totalLeads: number; booked: number; ambiguous: number; orphan: number; quoteSent: number; confirmedNoQuote: number }
  > = {};

  for (const shop of shops) {
    summary[shop.slug] = { totalLeads: 0, booked: 0, ambiguous: 0, orphan: 0, quoteSent: 0, confirmedNoQuote: 0 };

    // Leads in the lookback window — pull contact + first email
    const { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select(`
        id, source, contact_id, created_at, service_requested,
        contact:contacts(first_name, last_name, email, phone),
        vehicle:vehicles(year, make, model),
        email_messages(id, subject, sent_at, status)
      `)
      .eq("shop_id", shop.id)
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: false });

    if (leadsErr) {
      console.error(`Leads query failed for ${shop.slug}:`, leadsErr);
      continue;
    }
    if (!leads) continue;

    // Pull all bookings for any contact in this lead set
    const contactIds = leads.map((l: any) => l.contact_id).filter(Boolean) as string[];
    let bookings: any[] = [];
    if (contactIds.length > 0) {
      const { data } = await supabase
        .from("bookings")
        .select("id, contact_id, status, price_estimate, created_at, scheduled_start, service_name")
        .eq("shop_id", shop.id)
        .in("contact_id", contactIds)
        .gte("created_at", cutoffIso);
      bookings = data ?? [];
    }
    // How many leads each contact has (for ambiguity flagging)
    const leadCountByContact = new Map<string, number>();
    for (const l of leads as any[]) {
      if (!l.contact_id) continue;
      leadCountByContact.set(l.contact_id, (leadCountByContact.get(l.contact_id) ?? 0) + 1);
    }

    // Each booking attributes to AT MOST ONE lead — the most recent eligible
    // lead from that contact. Without this rule, a contact who submits
    // 5 leads then books once gets counted as 5 conversions.
    const leadsSortedNewestFirst = [...(leads as any[])].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const attributedBookingByLead = new Map<string, any>();
    const attributedBookingIds = new Set<string>();
    // Process bookings oldest-first, attribute each to the most recent
    // unallocated lead from that contact within the window.
    const bookingsOldestFirst = [...bookings].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    for (const booking of bookingsOldestFirst) {
      if (attributedBookingIds.has(booking.id)) continue;
      if (!booking.contact_id) continue;
      const bMs = new Date(booking.created_at).getTime();
      const candidate = leadsSortedNewestFirst.find((l) => {
        if (l.contact_id !== booking.contact_id) return false;
        if (attributedBookingByLead.has(l.id)) return false;
        const lMs = new Date(l.created_at).getTime();
        return lMs <= bMs && bMs - lMs <= conversionMs;
      });
      if (candidate) {
        attributedBookingByLead.set(candidate.id, booking);
        attributedBookingIds.add(booking.id);
      }
    }

    for (const lead of leads as any[]) {
      summary[shop.slug]!.totalLeads++;
      const sentEmails = (lead.email_messages ?? []).filter((m: any) => m.status === "sent" && m.sent_at);
      sentEmails.sort((a: any, b: any) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());

      // Classify each email by subject. The auto-confirmation ("we got your
      // enquiry") goes to every customer automatically and does NOT mean
      // we've actually engaged. The quote/estimate is the real contact —
      // sent by staff after approval, or auto-sent by the high-confidence
      // auto-respond path.
      const isConfirmation = (s: string) => s.startsWith("We've received your enquiry");
      const isTeamNotif = (s: string) => s.startsWith("New lead:");
      const confirmationEmail = sentEmails.find((m: any) => isConfirmation(m.subject ?? ""));
      const quoteEmail = sentEmails.find(
        (m: any) => !isConfirmation(m.subject ?? "") && !isTeamNotif(m.subject ?? "")
      );

      const matching = attributedBookingByLead.get(lead.id) ?? null;
      const leadMs = new Date(lead.created_at).getTime();
      if (quoteEmail) summary[shop.slug]!.quoteSent++;
      if (confirmationEmail && !quoteEmail) summary[shop.slug]!.confirmedNoQuote++;

      const contact = lead.contact ?? {};
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "—";
      const v = lead.vehicle ?? {};
      const vehicle = [v.year, v.make, v.model].filter(Boolean).join(" ") || "—";

      const leadCount = lead.contact_id ? leadCountByContact.get(lead.contact_id) ?? 1 : 1;

      const flags: string[] = [];
      if (matching) {
        summary[shop.slug]!.booked++;
        if (leadCount > 1) {
          flags.push(`ℹ️ contact has ${leadCount} leads — only this lead credited (most recent before booking)`);
          summary[shop.slug]!.ambiguous++;
        }
        if (!confirmationEmail && !quoteEmail) {
          flags.push(`📞 no email of any kind — likely phone-in`);
        } else if (!quoteEmail) {
          flags.push(`⚠️ booked WITHOUT us sending a quote — auto-confirm only`);
        }
      } else {
        if (!lead.contact_id) {
          flags.push(`❓ no contact_id — booking match impossible`);
          summary[shop.slug]!.orphan++;
        }
      }

      const lagMs = matching ? new Date(matching.created_at).getTime() - leadMs : null;
      const lagDays = lagMs === null ? null : Math.round((lagMs / (24 * 60 * 60 * 1000)) * 10) / 10;

      allRows.push({
        shopName: shop.name,
        leadId: lead.id,
        leadCreatedAt: lead.created_at,
        leadSource: lead.source ?? "unknown",
        contactId: lead.contact_id,
        contactName: name,
        contactEmail: contact.email ?? "—",
        contactPhone: contact.phone ?? null,
        vehicleLabel: vehicle,
        serviceRequested: lead.service_requested,
        confirmationSentAt: confirmationEmail?.sent_at ?? null,
        quoteSentAt: quoteEmail?.sent_at ?? null,
        quoteSubject: quoteEmail?.subject ?? null,
        bookingId: matching?.id ?? null,
        bookingCreatedAt: matching?.created_at ?? null,
        bookingStatus: matching?.status ?? null,
        bookingPrice: matching?.price_estimate ?? null,
        bookingScheduledStart: matching?.scheduled_start ?? null,
        lagDays,
        withinWindow: !!matching,
        contactLeadCount: leadCount,
        flag: flags.join("; "),
      });
    }
  }

  // Write the markdown
  const today = new Date().toISOString().slice(0, 10);
  const md: string[] = [];
  md.push(`# Conversion audit — ${today}`);
  md.push("");
  md.push(`Every lead from the last ${LOOKBACK_DAYS} days, with the booking we'd credit to it (if any). A lead is credited as "booked" if a booking for the same contact was created within ${CONVERSION_WINDOW_DAYS} days after the lead.`);
  md.push("");
  md.push(`Use this to spot-check the conversion-rate report:`);
  md.push(`- Look at booked rows. Does the contact name + lead source + booking date line up with what you remember?`);
  md.push(`- Look at flagged rows (⚠️ / 📞 / ❓). These are edge cases that might over- or under-count.`);
  md.push(`- Look at unbooked rows. Are there any contacts you're sure you booked? If yes, the contact_id linkage may be broken.`);
  md.push("");

  // Summary
  md.push(`## Summary`);
  md.push("");
  md.push(`| Shop | Leads (90d) | Auto-confirm only (no quote) | Quote sent | Booked | Ambiguous | Orphan |`);
  md.push(`|---|---:|---:|---:|---:|---:|---:|`);
  for (const shop of shops) {
    const s = summary[shop.slug]!;
    md.push(`| ${shop.name} | ${s.totalLeads} | ${s.confirmedNoQuote} | ${s.quoteSent} | ${s.booked} | ${s.ambiguous} | ${s.orphan} |`);
  }
  md.push("");
  md.push(`> **Auto-confirm only** = lead got the "we received your enquiry" auto-reply but staff never sent an actual quote. These are leads we may have dropped.`);
  md.push("");

  // Per-shop detail
  for (const shop of shops) {
    const rows = allRows.filter((r) => r.shopName === shop.name);
    if (rows.length === 0) continue;
    md.push(`## ${shop.name}`);
    md.push("");

    // Booked rows
    const booked = rows.filter((r) => r.withinWindow);
    md.push(`### Booked (${booked.length})`);
    md.push("");
    if (booked.length === 0) {
      md.push(`_None._`);
      md.push("");
    } else {
      md.push(`| Lead date | Source | Contact | Auto-confirm | Quote sent | Booking date | Lag | Booking status | Price | Service | Flags |`);
      md.push(`|---|---|---|---|---|---|---:|---|---:|---|---|`);
      for (const r of booked) {
        md.push(
          `| ${fmtDate(r.leadCreatedAt, shop.timezone)} | ${r.leadSource} | ${r.contactName} (${r.contactEmail}) | ${r.confirmationSentAt ? "✓ " + fmtDate(r.confirmationSentAt, shop.timezone) : "—"} | ${r.quoteSentAt ? "✓ " + fmtDate(r.quoteSentAt, shop.timezone) : "—"} | ${fmtDate(r.bookingCreatedAt, shop.timezone)} | ${r.lagDays}d | ${r.bookingStatus} | ${fmtNzd(r.bookingPrice)} | ${r.serviceRequested ?? "—"} | ${r.flag || ""} |`
        );
      }
      md.push("");
    }

    // Unbooked rows
    const unbooked = rows.filter((r) => !r.withinWindow);
    md.push(`### Unbooked (${unbooked.length})`);
    md.push("");
    if (unbooked.length === 0) {
      md.push(`_None._`);
      md.push("");
    } else {
      md.push(`| Lead date | Source | Contact | Auto-confirm | Quote sent | Service | Flags |`);
      md.push(`|---|---|---|---|---|---|---|`);
      for (const r of unbooked) {
        const noQuoteFlag = !r.quoteSentAt && r.confirmationSentAt ? "⏳ awaiting quote / approval" : r.flag;
        md.push(
          `| ${fmtDate(r.leadCreatedAt, shop.timezone)} | ${r.leadSource} | ${r.contactName} (${r.contactEmail}) | ${r.confirmationSentAt ? "✓ " + fmtDate(r.confirmationSentAt, shop.timezone) : "—"} | ${r.quoteSentAt ? "✓ " + fmtDate(r.quoteSentAt, shop.timezone) : "—"} | ${r.serviceRequested ?? "—"} | ${noQuoteFlag} |`
        );
      }
      md.push("");
    }
  }

  md.push(`---`);
  md.push("");
  md.push(`*Generated ${new Date().toISOString()} from ${LOOKBACK_DAYS}d of leads. Conversion window: ${CONVERSION_WINDOW_DAYS}d.*`);

  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const outPath = path.join(reportsDir, `conversion-audit-${today}.md`);
  fs.writeFileSync(outPath, md.join("\n"));

  // Print summary to terminal
  console.log("");
  console.log(`Audit summary (last ${LOOKBACK_DAYS} days):`);
  for (const shop of shops) {
    const s = summary[shop.slug]!;
    console.log(`  ${shop.name}: ${s.booked}/${s.totalLeads} booked, ${s.ambiguous} ambiguous, ${s.orphan} orphan`);
  }
  console.log("");
  console.log(`✓ Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
