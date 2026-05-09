/**
 * One-off retroactive de-dup of `contacts` rows.
 *
 * Background: a bug in /api/bookings/manual was inserting a fresh contact
 * row on every booking instead of looking up by email/phone. This created
 * duplicate contact rows and silently broke lead→booking attribution
 * (the lead's contact_id and the booking's contact_id were different rows
 * for the same person).
 *
 * This script:
 *   1. Groups contacts (per shop) by normalised email; then by phone.
 *   2. Picks a "canonical" survivor (the OLDEST row — usually the one
 *      created when the lead came in).
 *   3. Reassigns every leads / bookings / vehicles / email_messages row
 *      pointing at a duplicate to point at the survivor instead.
 *   4. Deletes the duplicates.
 *
 * Usage:
 *   npx tsx scripts/dedupe-contacts.ts          # dry run, prints plan
 *   npx tsx scripts/dedupe-contacts.ts --apply  # actually mutates data
 */

import fs from "node:fs";
import path from "node:path";

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

const APPLY = process.argv.includes("--apply");

function normaliseEmail(s: string | null) {
  return s?.toLowerCase().trim() || null;
}
function normalisePhone(s: string | null) {
  if (!s) return null;
  // Strip whitespace + leading zeros + + sign for matching purposes
  return s.replace(/[\s-]/g, "").trim() || null;
}

type Contact = {
  id: string;
  shop_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
};

async function main() {
  const supabase = getSupabaseAdminClient();

  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id, shop_id, first_name, last_name, full_name, email, phone, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;

  // Group by shop + email, then shop + phone
  const groups = new Map<string, Contact[]>();
  for (const c of (contacts ?? []) as Contact[]) {
    const e = normaliseEmail(c.email);
    if (e) {
      const key = `${c.shop_id}::email::${e}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
  }
  // Phone matches catch contacts with NO email but matching phone, OR rows
  // missed by email match. We process email first (canonical), then phone.
  const alreadyMatched = new Set<string>();
  for (const arr of groups.values()) {
    if (arr.length > 1) for (const c of arr) alreadyMatched.add(c.id);
  }
  const phoneGroups = new Map<string, Contact[]>();
  for (const c of (contacts ?? []) as Contact[]) {
    if (alreadyMatched.has(c.id)) continue;
    const p = normalisePhone(c.phone);
    if (p) {
      const key = `${c.shop_id}::phone::${p}`;
      phoneGroups.set(key, [...(phoneGroups.get(key) ?? []), c]);
    }
  }

  const dupGroups: Contact[][] = [];
  for (const arr of groups.values()) if (arr.length > 1) dupGroups.push(arr);
  for (const arr of phoneGroups.values()) if (arr.length > 1) dupGroups.push(arr);

  if (dupGroups.length === 0) {
    console.log("✓ No duplicate contacts found.");
    return;
  }

  console.log(`Found ${dupGroups.length} duplicate group${dupGroups.length === 1 ? "" : "s"}:\n`);

  let totalDuplicates = 0;
  const reassignmentPlan: Array<{ survivorId: string; mergeIds: string[]; example: string }> = [];

  for (const group of dupGroups) {
    // Sort oldest first → survivor
    group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const survivor = group[0]!;
    const mergeIds = group.slice(1).map((c) => c.id);
    totalDuplicates += mergeIds.length;
    const name = [survivor.first_name, survivor.last_name].filter(Boolean).join(" ") || survivor.full_name || "—";
    const example = `${name} (${survivor.email ?? survivor.phone ?? "?"})`;
    console.log(`  ${example}: keep ${survivor.id.slice(0, 8)}… merge ${mergeIds.length} dup${mergeIds.length === 1 ? "" : "s"}`);
    for (const id of mergeIds) console.log(`    └─ merge ${id}`);
    reassignmentPlan.push({ survivorId: survivor.id, mergeIds, example });
  }

  console.log(`\nTotal: ${totalDuplicates} duplicate contact rows across ${dupGroups.length} people.`);

  if (!APPLY) {
    console.log("\n(dry run — pass --apply to actually mutate)");
    return;
  }

  console.log("\nApplying merges…");
  let reassignedLeads = 0;
  let reassignedBookings = 0;
  let reassignedVehicles = 0;
  let reassignedEmails = 0;
  let deletedContacts = 0;

  for (const { survivorId, mergeIds } of reassignmentPlan) {
    for (const dupId of mergeIds) {
      // Reassign related rows
      const { count: leadsCount } = await supabase
        .from("leads")
        .update({ contact_id: survivorId }, { count: "exact" })
        .eq("contact_id", dupId);
      reassignedLeads += leadsCount ?? 0;

      const { count: bookingsCount } = await supabase
        .from("bookings")
        .update({ contact_id: survivorId }, { count: "exact" })
        .eq("contact_id", dupId);
      reassignedBookings += bookingsCount ?? 0;

      const { count: vehiclesCount } = await supabase
        .from("vehicles")
        .update({ contact_id: survivorId }, { count: "exact" })
        .eq("contact_id", dupId);
      reassignedVehicles += vehiclesCount ?? 0;

      const { count: emailsCount } = await supabase
        .from("email_messages")
        .update({ contact_id: survivorId }, { count: "exact" })
        .eq("contact_id", dupId);
      reassignedEmails += emailsCount ?? 0;

      // Delete duplicate contact
      const { error: delErr } = await supabase.from("contacts").delete().eq("id", dupId);
      if (delErr) {
        console.error(`  ! failed to delete contact ${dupId}: ${delErr.message}`);
        continue;
      }
      deletedContacts++;
    }
  }

  console.log(`\n✓ Done.`);
  console.log(`  Reassigned: ${reassignedLeads} leads, ${reassignedBookings} bookings, ${reassignedVehicles} vehicles, ${reassignedEmails} emails`);
  console.log(`  Deleted: ${deletedContacts} duplicate contact rows`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
