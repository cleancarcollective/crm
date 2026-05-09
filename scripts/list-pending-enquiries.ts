/**
 * One-off: list every real enquiry from the last 90 days that hasn't had
 * a quote sent. Filters out internal/test noise so you only see actual
 * customers we may have dropped the ball on.
 *
 * Run with: npx tsx scripts/list-pending-enquiries.ts
 *
 * Filters applied:
 *   - email domain @cleancarcollective.co.nz (internal tests)
 *   - contact name "Max Tebbs" (developer test account)
 *   - email tebbs.max@gmail.com (developer test account)
 *   - lead.source containing "test" or starting with "bridge-" (smoke tests)
 *
 * "Quote sent" = an email_messages row for the lead with status="sent" and
 * a subject that's not the auto-confirm and not a team notification.
 */

import fs from "node:fs";
import path from "node:path";

import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
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

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const LOOKBACK_DAYS = 90;

function isInternalOrTest(args: { email: string | null; firstName: string | null; lastName: string | null; source: string | null }) {
  const email = (args.email ?? "").toLowerCase();
  const fullName = [args.firstName, args.lastName].filter(Boolean).join(" ").toLowerCase();
  const source = (args.source ?? "").toLowerCase();

  if (!email.includes("@")) return true; // malformed/test data ("Aaa"/"bbb")
  if (email.endsWith("@cleancarcollective.co.nz")) return true;
  if (email.endsWith("@example.com") || email.endsWith("@example.org")) return true;
  if (email === "tebbs.max@gmail.com") return true;
  if (fullName.includes("max tebbs")) return true;
  if (fullName.includes("test")) return true;
  if (fullName.includes("check")) return true; // catches "Statuscheck", "DeployCheck"
  if (source.includes("test")) return true;
  if (source.startsWith("bridge-")) return true;
  return false;
}

const isConfirmation = (s: string) => s.startsWith("We've received your enquiry");
const isTeamNotif = (s: string) => s.startsWith("New lead:");

async function main() {
  const supabase = getSupabaseAdminClient();
  const cutoffIso = addDays(new Date(), -LOOKBACK_DAYS).toISOString();
  const now = new Date();

  const { data: shops } = await supabase
    .from("shops")
    .select("id, slug, name, timezone")
    .order("slug");
  if (!shops) throw new Error("No shops");

  const today = new Date().toISOString().slice(0, 10);
  const md: string[] = [];
  md.push(`# Pending enquiries — last ${LOOKBACK_DAYS} days (no quote sent)`);
  md.push("");
  md.push(`Real customer enquiries that have NOT received a quote/estimate. Excludes test data (cleancarcollective.co.nz emails, Max Tebbs, "test" sources). Generated ${today}.`);
  md.push("");

  let grandTotal = 0;
  const perShopTotals: Array<{ shop: string; pending: number; lostRevenueEstimate: string }> = [];

  for (const shop of shops) {
    const { data: leadsData, error: leadsErr } = await supabase
      .from("leads")
      .select(`
        id, source, status, contact_id, created_at, service_requested,
        contact:contacts(first_name, last_name, email, phone),
        vehicle:vehicles(year, make, model),
        email_messages(id, subject, status, sent_at)
      `)
      .eq("shop_id", shop.id)
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: false });

    if (leadsErr) {
      console.error(`Leads query failed for ${shop.slug}:`, leadsErr);
      continue;
    }

    const leads = (leadsData ?? []) as any[];

    // Pull bookings for any contact in the lead set so we can exclude leads
    // whose contact ended up booking via another channel (phone-in, etc.)
    const contactIds = leads.map((l) => l.contact_id).filter(Boolean) as string[];
    let bookedContactIds = new Set<string>();
    if (contactIds.length > 0) {
      const { data: bookingsData } = await supabase
        .from("bookings")
        .select("contact_id")
        .eq("shop_id", shop.id)
        .in("contact_id", contactIds);
      for (const b of bookingsData ?? []) {
        if (b.contact_id) bookedContactIds.add(b.contact_id);
      }
    }

    const pending = leads.filter((l) => {
      if (l.contact_id && bookedContactIds.has(l.contact_id)) return false;
      const c = l.contact ?? {};
      if (isInternalOrTest({
        email: c.email ?? null,
        firstName: c.first_name ?? null,
        lastName: c.last_name ?? null,
        source: l.source ?? null,
      })) return false;

      const sentEmails = (l.email_messages ?? []).filter((m: any) => m.status === "sent" && m.sent_at);
      const hasQuote = sentEmails.some(
        (m: any) => !isConfirmation(m.subject ?? "") && !isTeamNotif(m.subject ?? "")
      );
      return !hasQuote;
    });

    perShopTotals.push({ shop: shop.name, pending: pending.length, lostRevenueEstimate: "—" });
    grandTotal += pending.length;

    md.push(`## ${shop.name}`);
    md.push("");
    md.push(`**${pending.length} ${pending.length === 1 ? "enquiry" : "enquiries"} pending** (out of ${leads.length} total leads in window).`);
    md.push("");

    if (pending.length === 0) {
      md.push(`_Nothing waiting — clean slate._`);
      md.push("");
      continue;
    }

    md.push(`| # | Lead date | Days waiting | Contact | Email | Phone | Service | Vehicle | Source | Status |`);
    md.push(`|---|---|---:|---|---|---|---|---|---|---|`);
    pending.forEach((l, i) => {
      const c = l.contact ?? {};
      const v = l.vehicle ?? {};
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
      const vehicle = [v.year, v.make, v.model].filter(Boolean).join(" ") || "—";
      const leadDate = formatInTimeZone(l.created_at, shop.timezone, "d MMM HH:mm");
      const daysWaiting = Math.floor((now.getTime() - new Date(l.created_at).getTime()) / (24 * 60 * 60 * 1000));
      md.push(
        `| ${i + 1} | ${leadDate} | ${daysWaiting}d | ${name} | ${c.email ?? "—"} | ${c.phone ?? "—"} | ${l.service_requested ?? "—"} | ${vehicle} | ${l.source ?? "—"} | ${l.status ?? "—"} |`
      );
    });
    md.push("");
  }

  md.push(`---`);
  md.push("");
  md.push(`## Bottom line`);
  md.push("");
  md.push(`**${grandTotal} real enquiries waiting on a quote** across all shops.`);
  md.push("");
  md.push(`If average job value is ~$300 and even 30% would have booked with a quote, that's ~$${Math.round(grandTotal * 0.3 * 300).toLocaleString()} of potential revenue sitting in the queue.`);
  md.push("");
  md.push(`*Generated ${new Date().toISOString()}*`);

  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const outPath = path.join(reportsDir, `pending-enquiries-${today}.md`);
  fs.writeFileSync(outPath, md.join("\n"));

  console.log("");
  console.log(`Pending enquiries (last ${LOOKBACK_DAYS} days, real customers only):`);
  for (const t of perShopTotals) {
    console.log(`  ${t.shop}: ${t.pending}`);
  }
  console.log(`  TOTAL: ${grandTotal}`);
  console.log("");
  console.log(`✓ Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
