/**
 * One-off migration: Orbis X exports → CRM (Wellington).
 *
 * Run modes:
 *   npx tsx scripts/migrate-orbis-x.ts --shop wellington --type clients --file <path>            # dry-run
 *   npx tsx scripts/migrate-orbis-x.ts --shop wellington --type clients --file <path> --apply    # commit
 *   npx tsx scripts/migrate-orbis-x.ts --shop wellington --type leads   --file <path> --apply
 *
 * Behaviour:
 *   - Dry-run by default. --apply commits.
 *   - Idempotent: matches existing rows on Orbis ID stored in notes; rerunning
 *     never creates duplicates.
 *   - Filters obvious junk only (no contact info AT ALL, or test domains).
 *     When in doubt, imports — user explicitly said don't risk real leads.
 *   - Writes a summary report to reports/orbis-migration-<date>.md.
 *
 * Mappings:
 *   Clients file → lead.status="won", won_source="orbis-import";
 *     creates a synthetic booking when Last Appointment + P&L are present.
 *   Leads file   → lead.status="lost".
 */

import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

function loadEnv(file: string) {
  const envPath = path.join(process.cwd(), file);
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv(".env.local");

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

// ── Args ─────────────────────────────────────────────────────────────────
function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1]!;
}
const APPLY = process.argv.includes("--apply");
const SHOP_SLUG = arg("--shop");
const TYPE = arg("--type"); // "clients" | "leads"
const FILE_PATH = arg("--file");
const LIMIT_RAW = arg("--limit");
const LIMIT = LIMIT_RAW ? Number(LIMIT_RAW) : Infinity;

if (!SHOP_SLUG || !TYPE || !FILE_PATH) {
  console.error("Usage: npx tsx scripts/migrate-orbis-x.ts --shop <slug> --type clients|leads --file <path> [--apply] [--limit N]");
  process.exit(1);
}
if (TYPE !== "clients" && TYPE !== "leads") {
  console.error(`--type must be "clients" or "leads", got "${TYPE}"`);
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────
function s(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
function nonEmpty(v: string): string | null {
  if (!v) return null;
  if (v === "NULL" || v === "null" || v === "0") return null;
  return v;
}
function pickDate(v: unknown): string | null {
  // Orbis exports dates as either "YYYY-MM-DD" or Excel serial numbers
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    // Excel serial → JS Date
    const ms = (v - 25569) * 86400 * 1000;
    return new Date(ms).toISOString();
  }
  const str = String(v).trim();
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}
function emailKey(v: string): string {
  return v.toLowerCase().trim();
}
function phoneKey(v: string): string {
  // Strip whitespace and -. Keeps + for international format.
  return v.replace(/[\s\-()]/g, "").trim();
}

function isJunkRow(row: Record<string, unknown>): { junk: boolean; reason?: string } {
  const email = s(row["Email"]);
  const phone = s(row["Phone"]);
  const firstName = s(row["First Name"]);
  const lastName = s(row["Last Name"]);
  const fullName = s(row["Name"]);
  const name = (firstName + " " + lastName).trim() || fullName;
  const lowerEmail = email.toLowerCase();
  const lowerName = name.toLowerCase();

  // Genuinely unreachable + nameless
  if (!email && !phone && !name) return { junk: true, reason: "no contact info & no name" };

  // Obvious test domains
  if (lowerEmail.endsWith("@example.com") || lowerEmail.endsWith("@example.org")) {
    return { junk: true, reason: "example.com test email" };
  }
  if (lowerEmail.endsWith("@cleancarcollective.co.nz")) {
    return { junk: true, reason: "internal cleancarcollective.co.nz email" };
  }
  if (lowerEmail === "tebbs.max@gmail.com") {
    return { junk: true, reason: "developer test account" };
  }

  // Obviously fake names (only if name is the only contact info — otherwise keep)
  const isJunkName = lowerName === "test" || lowerName === "aaa" || lowerName === "bbb" || lowerName === "qqq" ||
                     lowerName.startsWith("test ") || lowerName === "asdf" || lowerName === "xxx";
  if (isJunkName && !email && !phone) return { junk: true, reason: `junk name "${name}"` };

  return { junk: false };
}

type StatTotals = {
  read: number;
  filteredJunk: number;
  filterReasons: Record<string, number>;
  alreadyImported: number; // matched on Orbis ID
  contactsCreated: number;
  contactsReused: number;
  vehiclesCreated: number;
  leadsCreated: number;
  bookingsCreated: number;
  errors: Array<{ row: number; reason: string }>;
};

const stats: StatTotals = {
  read: 0,
  filteredJunk: 0,
  filterReasons: {},
  alreadyImported: 0,
  contactsCreated: 0,
  contactsReused: 0,
  vehiclesCreated: 0,
  leadsCreated: 0,
  bookingsCreated: 0,
  errors: [],
};

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const supabase = getSupabaseAdminClient();
  const { data: shopRow } = await supabase.from("shops").select("id, slug, name").eq("slug", SHOP_SLUG).single();
  if (!shopRow) throw new Error(`Shop "${SHOP_SLUG}" not found`);
  const shopId = shopRow.id;

  console.log(`\n${APPLY ? "Applying" : "Dry-run"}: ${TYPE} → ${shopRow.slug}`);
  console.log(`File: ${FILE_PATH}\n`);

  // Read file
  const wb = XLSX.readFile(FILE_PATH!);
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
  console.log(`Loaded ${rows.length} rows.`);

  // Pre-load existing leads' internal_notes so we can short-circuit on Orbis ID
  // (we tag every imported lead with "[orbis Client/Lead ID: 12345]" in
  // internal_notes for traceability + idempotency).
  const { data: existingLeads } = await supabase
    .from("leads")
    .select("id, internal_notes")
    .eq("shop_id", shopId)
    .like("internal_notes", "%orbis%");
  const existingOrbisIds = new Set<string>();
  for (const l of (existingLeads ?? []) as Array<{ internal_notes: string | null }>) {
    const m = l.internal_notes?.match(/orbis (?:Client|Lead) ID:\s*(\d+)/i);
    if (m) existingOrbisIds.add(m[1]!);
  }
  console.log(`Found ${existingOrbisIds.size} previously-imported Orbis rows on this shop.\n`);

  let processed = 0;
  for (let i = 0; i < rows.length && processed < LIMIT; i++) {
    const row = rows[i]!;
    stats.read++;

    const junk = isJunkRow(row);
    if (junk.junk) {
      stats.filteredJunk++;
      stats.filterReasons[junk.reason ?? "?"] = (stats.filterReasons[junk.reason ?? "?"] ?? 0) + 1;
      continue;
    }

    const orbisId = s(row[TYPE === "clients" ? "Client ID" : "Lead ID"]);
    if (orbisId && existingOrbisIds.has(orbisId)) {
      stats.alreadyImported++;
      continue;
    }

    processed++;

    try {
      await processRow(supabase, shopId, row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.errors.push({ row: i + 2, reason: msg }); // +2 = header + 1-indexed
      console.error(`  Row ${i + 2}: ${msg}`);
    }
  }

  await writeReport(shopRow.slug, FILE_PATH!);
}

async function processRow(supabase: any, shopId: string, row: Record<string, unknown>) {
  const email = nonEmpty(s(row["Email"]).toLowerCase());
  const phone = nonEmpty(s(row["Phone"]));
  const firstName = nonEmpty(s(row["First Name"])) ?? nonEmpty(s(row["Name"]).split(" ")[0] ?? "");
  const lastName = nonEmpty(s(row["Last Name"])) ?? nonEmpty(s(row["Name"]).split(" ").slice(1).join(" "));
  const fullName = nonEmpty(s(row["Name"])) ?? ([firstName, lastName].filter(Boolean).join(" ") || null);

  const orbisIdLabel = TYPE === "clients" ? "Client ID" : "Lead ID";
  const orbisId = nonEmpty(s(row[orbisIdLabel]));
  const orbisLeadId = nonEmpty(s(row["Lead ID"]));
  const sourceOrig = nonEmpty(s(row["Source"])) ?? "orbis-import";
  const tagsOrig = nonEmpty(s(row["Tags"]));

  // ── Contact upsert ────────────────────────────────────────────────────
  let contactId: string;
  let foundExisting: any = null;
  if (email) {
    const { data } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, full_name, phone")
      .eq("shop_id", shopId)
      .ilike("email", email)
      .maybeSingle();
    foundExisting = data;
  }
  if (!foundExisting && phone) {
    const phoneN = phoneKey(phone);
    const { data } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, full_name, email")
      .eq("shop_id", shopId)
      .eq("phone", phone)
      .maybeSingle();
    foundExisting = data;
  }

  if (foundExisting) {
    contactId = foundExisting.id;
    stats.contactsReused++;
    // Patch missing fields
    const patch: Record<string, unknown> = {};
    if (!foundExisting.email && email) patch["email"] = email;
    if (!foundExisting.phone && phone) patch["phone"] = phone;
    if (!foundExisting.first_name && firstName) patch["first_name"] = firstName;
    if (!foundExisting.last_name && lastName) patch["last_name"] = lastName;
    if (!foundExisting.full_name && fullName) patch["full_name"] = fullName;
    if (APPLY && Object.keys(patch).length > 0) {
      await supabase.from("contacts").update(patch).eq("id", contactId);
    }
  } else {
    if (APPLY) {
      const { data: created, error } = await supabase
        .from("contacts")
        .insert({
          shop_id: shopId,
          first_name: firstName,
          last_name: lastName,
          full_name: fullName,
          email,
          phone,
          notes: nonEmpty(s(row["Notes"])),
        })
        .select("id")
        .single();
      if (error || !created) throw new Error(`contact insert failed: ${error?.message ?? "unknown"}`);
      contactId = created.id;
    } else {
      contactId = "DRY-RUN-CONTACT-ID";
    }
    stats.contactsCreated++;
  }

  // ── Vehicle upsert (if any vehicle data is present) ───────────────────
  const vYear = nonEmpty(s(row["Vehicle Year"]));
  const vMake = nonEmpty(s(row["Vehicle Make"]));
  const vModel = nonEmpty(s(row["Vehicle Model"]));
  const vRego = nonEmpty(s(row["Plate Number"]));
  const vNotes = nonEmpty(s(row["Vehicle Notes"]));

  let vehicleId: string | null = null;
  if (vMake || vModel || vRego || vYear) {
    // Match existing on contact + (year + make + model) OR rego
    let existing: any = null;
    if (vRego) {
      const { data } = await supabase
        .from("vehicles")
        .select("id")
        .eq("shop_id", shopId)
        .eq("contact_id", contactId)
        .ilike("rego", vRego)
        .maybeSingle();
      existing = data;
    }
    if (!existing && (vMake || vModel)) {
      const { data } = await supabase
        .from("vehicles")
        .select("id, year, make, model")
        .eq("shop_id", shopId)
        .eq("contact_id", contactId);
      existing = (data ?? []).find((v: any) =>
        (vMake ? (v.make ?? "").toLowerCase() === vMake.toLowerCase() : true) &&
        (vModel ? (v.model ?? "").toLowerCase() === vModel.toLowerCase() : true)
      ) ?? null;
    }
    if (existing) {
      vehicleId = existing.id;
    } else {
      if (APPLY && contactId !== "DRY-RUN-CONTACT-ID") {
        const { data: created, error } = await supabase
          .from("vehicles")
          .insert({
            shop_id: shopId,
            contact_id: contactId,
            year: vYear,
            make: vMake,
            model: vModel,
            rego: vRego,
            notes: vNotes,
          })
          .select("id")
          .single();
        if (error || !created) throw new Error(`vehicle insert failed: ${error?.message ?? "unknown"}`);
        vehicleId = created.id;
      } else {
        vehicleId = "DRY-RUN-VEHICLE-ID";
      }
      stats.vehiclesCreated++;
    }
  }

  // ── Lead insert ───────────────────────────────────────────────────────
  const leadStatus = TYPE === "clients" ? "won" : "lost";
  const wonSource = TYPE === "clients" ? "orbis-import" : null;
  const leadCreatedAt =
    pickDate(row["Lead Created Date"]) ??
    pickDate(row["Date Added"]) ??
    new Date().toISOString();

  const traceability = [
    `[orbis ${TYPE === "clients" ? "Client ID" : "Lead ID"}: ${orbisId ?? "?"}]`,
    orbisLeadId && orbisLeadId !== orbisId ? `[orbis Lead ID: ${orbisLeadId}]` : "",
    tagsOrig ? `[tags: ${tagsOrig}]` : "",
  ].filter(Boolean).join(" ");

  if (APPLY && contactId !== "DRY-RUN-CONTACT-ID") {
    const { error } = await supabase.from("leads").insert({
      shop_id: shopId,
      contact_id: contactId,
      vehicle_id: vehicleId === "DRY-RUN-VEHICLE-ID" ? null : vehicleId,
      source: "orbis-import",
      source_detail: sourceOrig,
      service_requested: nonEmpty(s(row["Last Service"])),
      notes: nonEmpty(s(row["Notes"])),
      status: leadStatus,
      won_source: wonSource,
      internal_notes: traceability,
      created_at: leadCreatedAt,
      updated_at: pickDate(row["Last Updated"]) ?? leadCreatedAt,
      booked_at: TYPE === "clients" ? pickDate(row["Last Appointment"]) : null,
    });
    if (error) throw new Error(`lead insert failed: ${error.message}`);
  }
  stats.leadsCreated++;

  // ── Synthetic booking from "Last Appointment" (clients only) ─────────
  if (TYPE === "clients") {
    const appointmentDate = pickDate(row["Last Appointment"]);
    const lastService = nonEmpty(s(row["Last Service"]));
    const pAndL = row["P&L"];
    const priceEstimate = typeof pAndL === "number" ? pAndL : null;

    if (appointmentDate) {
      // 4-hour default block (we don't know the actual duration from Orbis)
      const start = new Date(appointmentDate);
      const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
      if (APPLY && contactId !== "DRY-RUN-CONTACT-ID") {
        const { error } = await supabase.from("bookings").insert({
          shop_id: shopId,
          contact_id: contactId,
          vehicle_id: vehicleId === "DRY-RUN-VEHICLE-ID" ? null : vehicleId,
          booking_source: "orbis-x-migration",
          service_name: lastService ?? "Detail (migrated from Orbis)",
          scheduled_start: start.toISOString(),
          scheduled_end: end.toISOString(),
          status: "completed",
          price_estimate: priceEstimate,
          notes: traceability,
          duration_minutes: 240,
          location_type: "in_shop",
          raw_payload: {},
          created_at: appointmentDate,
          updated_at: appointmentDate,
        });
        if (error) throw new Error(`booking insert failed: ${error.message}`);
      }
      stats.bookingsCreated++;
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────
async function writeReport(shopSlug: string, filePath: string) {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Orbis migration ${APPLY ? "" : "DRY-RUN"} — ${today}`);
  lines.push("");
  lines.push(`Shop: ${shopSlug}    Type: ${TYPE}    File: ${path.basename(filePath)}`);
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`|---|---:|`);
  lines.push(`| Rows read | ${stats.read} |`);
  lines.push(`| Filtered as junk | ${stats.filteredJunk} |`);
  lines.push(`| Already imported (idempotent skip) | ${stats.alreadyImported} |`);
  lines.push(`| Contacts created | ${stats.contactsCreated} |`);
  lines.push(`| Contacts reused (dedup match) | ${stats.contactsReused} |`);
  lines.push(`| Vehicles created | ${stats.vehiclesCreated} |`);
  lines.push(`| Leads created | ${stats.leadsCreated} |`);
  if (TYPE === "clients") lines.push(`| Bookings created | ${stats.bookingsCreated} |`);
  lines.push(`| Errors | ${stats.errors.length} |`);
  lines.push("");

  if (Object.keys(stats.filterReasons).length > 0) {
    lines.push(`## Junk filter breakdown`);
    lines.push("");
    for (const [reason, n] of Object.entries(stats.filterReasons)) {
      lines.push(`- **${n}** — ${reason}`);
    }
    lines.push("");
  }

  if (stats.errors.length > 0) {
    lines.push(`## Errors (${stats.errors.length})`);
    lines.push("");
    for (const e of stats.errors.slice(0, 50)) {
      lines.push(`- Row ${e.row}: ${e.reason}`);
    }
    if (stats.errors.length > 50) lines.push(`- … and ${stats.errors.length - 50} more`);
    lines.push("");
  }

  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const outPath = path.join(reportsDir, `orbis-migration-${TYPE}-${shopSlug}-${today}${APPLY ? "" : "-dryrun"}.md`);
  fs.writeFileSync(outPath, lines.join("\n"));

  console.log("\n--- Summary ---");
  for (const line of lines.slice(0, lines.indexOf("") + 12)) console.log(line);
  console.log(`\n${APPLY ? "✓ Applied" : "(dry run — pass --apply to commit)"}`);
  console.log(`Report: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
