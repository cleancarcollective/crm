/**
 * Verify the delivery state of recent Wellington outbound emails. Pulls
 * email_messages + email_events for the last N days, plus optionally a
 * single message by recipient or lead id.
 *
 * Usage:
 *   npx tsx scripts/check-email-delivery.ts                       # last 7 days
 *   npx tsx scripts/check-email-delivery.ts --days 14
 *   npx tsx scripts/check-email-delivery.ts --recipient eleanor   # also matches partial
 */

import fs from "node:fs";
import path from "node:path";

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
loadEnv(".env.vercel.local");

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1]!;
}

async function main() {
  const days = Number(arg("--days", "7"));
  const recipient = arg("--recipient");

  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase.from("shops").select("id, slug").eq("slug", "wellington").single();
  if (!shop) throw new Error("no wellington");

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // ── Aggregate stats ────────────────────────────────────────────────────
  const { data: msgs } = await supabase
    .from("email_messages")
    .select("id, contact_id, subject, status, sent_at, provider_message_id, created_at")
    .eq("shop_id", shop.id)
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (!msgs || msgs.length === 0) {
    console.log(`No emails in the last ${days} days for Wellington.`);
    return;
  }

  // Fetch events for all those messages in batches
  const msgIds = msgs.map((m) => m.id as string);
  const events: Array<{ email_message_id: string; event_type: string; event_timestamp: string; metadata_json: any }> = [];
  for (let i = 0; i < msgIds.length; i += 200) {
    const batch = msgIds.slice(i, i + 200);
    const { data } = await supabase
      .from("email_events")
      .select("email_message_id, event_type, event_timestamp, metadata_json")
      .in("email_message_id", batch);
    events.push(...((data ?? []) as any[]));
  }

  const eventsByMsg = new Map<string, typeof events>();
  for (const e of events) {
    const arr = eventsByMsg.get(e.email_message_id) ?? [];
    arr.push(e);
    eventsByMsg.set(e.email_message_id, arr);
  }

  // Aggregate
  const buckets = {
    total: msgs.length,
    sent: 0,
    failed: 0,
    queued: 0,
    delivered: 0,
    bounced: 0,
    spam: 0,
    opened: 0,
    clicked: 0,
    noEventsAfterSent: 0,
  };

  for (const m of msgs) {
    if (m.status === "sent") buckets.sent++;
    else if (m.status === "failed") buckets.failed++;
    else if (m.status === "queued") buckets.queued++;
    const evs = eventsByMsg.get(m.id as string) ?? [];
    const types = new Set(evs.map((e) => e.event_type));
    if (types.has("delivery") || types.has("delivered")) buckets.delivered++;
    if (types.has("bounce") || types.has("bounced") || types.has("hardbounce")) buckets.bounced++;
    if (types.has("spamcomplaint")) buckets.spam++;
    if (types.has("open")) buckets.opened++;
    if (types.has("click")) buckets.clicked++;
    if (m.status === "sent" && evs.length === 0) buckets.noEventsAfterSent++;
  }

  console.log(`\nWellington email activity, last ${days} days`);
  console.log(`================================================`);
  console.log(`Outbound messages:        ${buckets.total}`);
  console.log(`  status=sent:            ${buckets.sent}`);
  console.log(`  status=failed:          ${buckets.failed}`);
  console.log(`  status=queued:          ${buckets.queued}`);
  console.log(`Postmark events:`);
  console.log(`  delivered:              ${buckets.delivered}`);
  console.log(`  bounced:                ${buckets.bounced}`);
  console.log(`  spam complaints:        ${buckets.spam}`);
  console.log(`  opens:                  ${buckets.opened} (tracking off, expect 0)`);
  console.log(`  clicks:                 ${buckets.clicked} (tracking off, expect 0)`);
  console.log(`  no events after sent:   ${buckets.noEventsAfterSent}`);

  if (buckets.sent > 0) {
    const dlvRate = Math.round((buckets.delivered / buckets.sent) * 100);
    const bncRate = Math.round((buckets.bounced / buckets.sent) * 100);
    console.log(`Delivery rate:            ${dlvRate}%`);
    console.log(`Bounce rate:              ${bncRate}%`);
  }

  // ── Per-recipient drill-down ───────────────────────────────────────────
  if (recipient) {
    console.log(`\nLooking for recipient match on "${recipient}":\n`);
    const lower = recipient.toLowerCase();
    // Match via contact_id → contact email/name. Pull contacts for all msgs.
    const contactIds = [...new Set(msgs.map((m) => m.contact_id).filter(Boolean) as string[])];
    const contactsById = new Map<string, any>();
    for (let i = 0; i < contactIds.length; i += 200) {
      const batch = contactIds.slice(i, i + 200);
      const { data } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, full_name, email")
        .in("id", batch);
      for (const c of (data ?? []) as any[]) contactsById.set(c.id, c);
    }

    const matches = msgs.filter((m) => {
      const c = m.contact_id ? contactsById.get(m.contact_id) : null;
      if (!c) return false;
      const hay = `${c.first_name ?? ""} ${c.last_name ?? ""} ${c.full_name ?? ""} ${c.email ?? ""}`.toLowerCase();
      return hay.includes(lower);
    });

    if (matches.length === 0) {
      console.log("(no match)");
    } else {
      for (const m of matches) {
        const c = m.contact_id ? contactsById.get(m.contact_id) : null;
        const evs = eventsByMsg.get(m.id as string) ?? [];
        console.log(`Msg ${(m.id as string).slice(0, 8)}  ${m.sent_at ?? "(unsent)"}`);
        console.log(`  to:          ${c?.full_name ?? "?"} <${c?.email ?? "?"}>`);
        console.log(`  subject:     ${m.subject}`);
        console.log(`  status:      ${m.status}`);
        console.log(`  provider id: ${m.provider_message_id ?? "(none)"}`);
        if (evs.length === 0) {
          console.log(`  events:      (none)`);
        } else {
          console.log(`  events:`);
          for (const e of evs.sort((a, b) => a.event_timestamp.localeCompare(b.event_timestamp))) {
            const md = e.metadata_json as any;
            const recip = md?.Recipient ?? md?.Email ?? "";
            console.log(`    ${e.event_timestamp.slice(0, 19)}  ${e.event_type.padEnd(15)}  ${recip}`);
          }
        }
        console.log("");
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
