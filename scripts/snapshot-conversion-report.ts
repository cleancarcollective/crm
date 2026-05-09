/**
 * One-off conversion snapshot. Run with:
 *   npx tsx scripts/snapshot-conversion-report.ts
 *
 * Loads env from .env.local, computes funnel stats for the last 8 weeks per
 * shop plus an all-time summary, and writes a Markdown report to
 * reports/conversion-snapshot-<date>.md.
 *
 * Read-only. No emails sent. Safe to run anytime.
 */

import fs from "node:fs";
import path from "node:path";

import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

// Load .env.local before importing anything that touches env vars
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

import type { ShopRecord } from "@/lib/dashboard/types";
import {
  CONVERSION_WINDOW_DAYS,
  gatherConversionStats,
} from "@/lib/email/sendWeeklyConversionReport";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function pct(num: number, denom: number) {
  if (denom === 0) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

function fmtNzd(n: number) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 }).format(n);
}

/**
 * Mon–Sun cohort window for `weeksAgo` weeks ago in shop tz.
 * weeksAgo=0 → this week's Monday onward (still in progress)
 * weeksAgo=1 → last completed week
 * weeksAgo=2 → the week before last (the one the cron uses)
 */
function getWeeklyWindow(now: Date, tz: string, weeksAgo: number) {
  const dayOfWeek = Number(formatInTimeZone(now, tz, "i")); // 1=Mon..7=Sun
  const daysSinceMonday = dayOfWeek - 1;
  const todayDateStr = formatInTimeZone(now, tz, "yyyy-MM-dd");
  const anchor = new Date(`${todayDateStr}T00:00:00Z`);
  const thisMonday = addDays(anchor, -daysSinceMonday);
  const start = addDays(thisMonday, -7 * (weeksAgo + 1));
  const end = addDays(thisMonday, -7 * weeksAgo);
  const offset = formatInTimeZone(now, tz, "XXX");
  return {
    cohortStartIso: `${formatInTimeZone(start, tz, "yyyy-MM-dd")}T00:00:00${offset}`,
    cohortEndIso: `${formatInTimeZone(end, tz, "yyyy-MM-dd")}T00:00:00${offset}`,
    cohortLabel: `${formatInTimeZone(start, tz, "EEE d MMM")} – ${formatInTimeZone(addDays(end, -1), tz, "EEE d MMM")}`,
  };
}

async function snapshotShop(shop: ShopRecord, weeks = 8) {
  const now = new Date();

  // All-time = from epoch to now-30d (so leads have had time to convert)
  const allTimeEnd = addDays(now, -CONVERSION_WINDOW_DAYS);
  const allTimeStats = await gatherConversionStats({
    shop,
    cohortStartIso: "1970-01-01T00:00:00Z",
    cohortEndIso: allTimeEnd.toISOString(),
    cohortLabel: `All-time through ${formatInTimeZone(allTimeEnd, shop.timezone, "d MMM yyyy")}`,
  });

  // Weekly cohorts: last `weeks` complete weeks (skip in-progress this-week)
  const weekly: Awaited<ReturnType<typeof gatherConversionStats>>[] = [];
  for (let w = 1; w <= weeks; w++) {
    const win = getWeeklyWindow(now, shop.timezone, w);
    weekly.push(await gatherConversionStats({ shop, ...win }));
  }

  return { shop, allTime: allTimeStats, weekly };
}

function renderShopMd(snap: Awaited<ReturnType<typeof snapshotShop>>): string {
  const { shop, allTime, weekly } = snap;
  const lines: string[] = [];

  lines.push(`## ${shop.name}`);
  lines.push("");

  // All-time funnel
  const a = allTime.totals;
  lines.push(`### All-time funnel`);
  lines.push(`*Cohort: ${allTime.cohortLabel} (only includes leads ≥${CONVERSION_WINDOW_DAYS}d old to allow conversion time)*`);
  lines.push("");
  lines.push(`| Stage | Count | % of leads | Step rate |`);
  lines.push(`|---|---:|---:|---:|`);
  lines.push(`| Leads received | ${a.leads} | — | — |`);
  lines.push(`| First email sent | ${a.firstEmailSent} | ${pct(a.firstEmailSent, a.leads)} | ${pct(a.firstEmailSent, a.leads)} |`);
  lines.push(`| Email opened | ${a.opened} | ${pct(a.opened, a.leads)} | ${pct(a.opened, a.firstEmailSent)} |`);
  lines.push(`| Email clicked | ${a.clicked} | ${pct(a.clicked, a.leads)} | ${pct(a.clicked, a.opened)} |`);
  lines.push(`| **Booked** | **${a.booked}** | **${pct(a.booked, a.leads)}** | — |`);
  lines.push(`| Completed | ${a.completed} | ${pct(a.completed, a.leads)} | ${pct(a.completed, a.booked)} |`);
  lines.push(`| Revenue (completed) | ${fmtNzd(a.revenue)} | | |`);
  lines.push("");

  // By source (all-time)
  const sources = Object.entries(allTime.sources).sort(([, x], [, y]) => y.leads - x.leads);
  if (sources.length > 0) {
    lines.push(`### By source (all-time)`);
    lines.push("");
    lines.push(`| Source | Leads | Booked | Conversion |`);
    lines.push(`|---|---:|---:|---:|`);
    for (const [src, v] of sources) {
      lines.push(`| ${src} | ${v.leads} | ${v.booked} | ${pct(v.booked, v.leads)} |`);
    }
    lines.push("");
  }

  // Weekly trend
  lines.push(`### Last ${weekly.length} weeks`);
  lines.push("");
  lines.push(`| Week | Leads | Sent | Opened | Clicked | Booked | Conv % |`);
  lines.push(`|---|---:|---:|---:|---:|---:|---:|`);
  // Reverse so most recent is first
  for (const w of weekly) {
    const t = w.totals;
    lines.push(
      `| ${w.cohortLabel} | ${t.leads} | ${t.firstEmailSent} | ${t.opened} | ${t.clicked} | ${t.booked} | ${pct(t.booked, t.leads)} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

function biggestDropMd(totals: { leads: number; firstEmailSent: number; opened: number; clicked: number; booked: number }) {
  const stages = [
    { name: "Leads received", count: totals.leads },
    { name: "First email sent", count: totals.firstEmailSent },
    { name: "Email opened", count: totals.opened },
    { name: "Email clicked", count: totals.clicked },
    { name: "Booked", count: totals.booked },
  ];
  let worst: { from: string; to: string; lostPct: number } | null = null;
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1]!;
    const cur = stages[i]!;
    if (prev.count === 0) continue;
    const lost = (prev.count - cur.count) / prev.count;
    if (lost > 0 && (worst === null || lost > worst.lostPct)) {
      worst = { from: prev.name, to: cur.name, lostPct: lost };
    }
  }
  return worst;
}

async function main() {
  const supabase = getSupabaseAdminClient();
  const { data: shopsRaw, error } = await supabase
    .from("shops")
    .select("id, slug, name, timezone")
    .order("slug");
  if (error || !shopsRaw) throw new Error(`Failed to load shops: ${error?.message}`);

  const shops = shopsRaw as ShopRecord[];
  const snapshots: Awaited<ReturnType<typeof snapshotShop>>[] = [];
  for (const shop of shops) {
    process.stdout.write(`Gathering ${shop.slug}... `);
    snapshots.push(await snapshotShop(shop, 8));
    process.stdout.write(`done\n`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const md: string[] = [];
  md.push(`# Conversion snapshot — ${today}`);
  md.push("");
  md.push(`Auto-generated by \`scripts/snapshot-conversion-report.ts\`. A lead is counted as **booked** if any booking for the same contact was created within ${CONVERSION_WINDOW_DAYS} days after the lead. No manual "won" flag required.`);
  md.push("");
  md.push(`## TL;DR`);
  md.push("");
  md.push(`| Shop | All-time leads | Booked | Conversion | Biggest drop-off |`);
  md.push(`|---|---:|---:|---:|---|`);
  for (const snap of snapshots) {
    const t = snap.allTime.totals;
    const drop = biggestDropMd(t);
    const dropTxt = drop ? `${Math.round(drop.lostPct * 100)}% lost: ${drop.from} → ${drop.to}` : "—";
    md.push(`| ${snap.shop.name} | ${t.leads} | ${t.booked} | ${pct(t.booked, t.leads)} | ${dropTxt} |`);
  }
  md.push("");

  for (const snap of snapshots) {
    md.push(renderShopMd(snap));
  }

  md.push(`---`);
  md.push("");
  md.push(`*Generated ${new Date().toISOString()}*`);

  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const outPath = path.join(reportsDir, `conversion-snapshot-${today}.md`);
  fs.writeFileSync(outPath, md.join("\n"));

  // Print TL;DR to terminal
  console.log("");
  console.log(md.slice(0, md.findIndex((l) => l === "") + 8).join("\n"));
  console.log("");
  console.log(`✓ Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
