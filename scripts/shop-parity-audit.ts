/**
 * Audit per-shop configuration parity. Shows every shop-scoped config table
 * and where Christchurch and Wellington differ — so we can spot when one
 * shop is missing a template, rule, or service the other shop has.
 *
 * Read-only. Run with: npx tsx scripts/shop-parity-audit.ts
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

// Tables we expect to be per-shop config (vs. transactional data like leads).
// "key" is the column we use to compare rows across shops — i.e. two rows
// with the same key in different shops are considered "the same template".
const CONFIG_TABLES: Array<{ table: string; key: string; selectExtra?: string }> = [
  { table: "email_templates", key: "key", selectExtra: "is_active, name" },
  { table: "lead_email_templates", key: "template_key", selectExtra: "variant" },
  { table: "pricing", key: "service_name", selectExtra: "size, price_ex_gst" },
  // sms_templates table not yet created — migration pending
];

// Other tables to just count (per-shop data, parity less meaningful)
const COUNT_TABLES = ["leads", "contacts", "bookings", "vehicles"];

async function main() {
  const supabase = getSupabaseAdminClient();

  const { data: shops } = await supabase
    .from("shops")
    .select("id, slug, name")
    .order("slug");
  if (!shops) throw new Error("No shops");

  console.log("\n=== SHOP PARITY AUDIT ===\n");
  console.log(`Shops: ${shops.map((s) => s.slug).join(", ")}\n`);

  // Count tables — informational only
  console.log("--- Volume (per-shop transactional data) ---");
  for (const table of COUNT_TABLES) {
    const counts = await Promise.all(
      shops.map(async (s) => {
        const { count } = await supabase.from(table).select("*", { count: "exact", head: true }).eq("shop_id", s.id);
        return { slug: s.slug, count: count ?? 0 };
      })
    );
    console.log(`  ${table.padEnd(15)} ${counts.map((c) => `${c.slug}: ${c.count}`).join(" · ")}`);
  }
  console.log("");

  // Config tables — diff
  for (const cfg of CONFIG_TABLES) {
    console.log(`--- ${cfg.table} (per-shop config) ---`);

    const selectCols = `id, shop_id, ${cfg.key}${cfg.selectExtra ? ", " + cfg.selectExtra : ""}`;
    const { data, error } = await supabase.from(cfg.table).select(selectCols);
    if (error) {
      console.log(`  ! Error: ${error.message}`);
      console.log("");
      continue;
    }

    // Group by shop_id, then collect set of keys
    const byShop = new Map<string, Set<string>>();
    const keysByShop = new Map<string, Map<string, any>>();
    for (const row of (data ?? []) as any[]) {
      if (!byShop.has(row.shop_id)) {
        byShop.set(row.shop_id, new Set());
        keysByShop.set(row.shop_id, new Map());
      }
      byShop.get(row.shop_id)!.add(row[cfg.key]);
      keysByShop.get(row.shop_id)!.set(row[cfg.key], row);
    }

    // Print count per shop
    for (const shop of shops) {
      const keys = byShop.get(shop.id) ?? new Set();
      console.log(`  ${shop.slug.padEnd(15)} ${keys.size} rows`);
    }

    // Diff: for each pair of shops, what does one have that the other doesn't?
    if (shops.length >= 2) {
      const [a, b] = shops as Array<{ id: string; slug: string }>;
      const aKeys = byShop.get(a!.id) ?? new Set();
      const bKeys = byShop.get(b!.id) ?? new Set();
      const onlyInA = [...aKeys].filter((k) => !bKeys.has(k)).sort();
      const onlyInB = [...bKeys].filter((k) => !aKeys.has(k)).sort();
      const inBoth = [...aKeys].filter((k) => bKeys.has(k)).sort();

      if (onlyInA.length === 0 && onlyInB.length === 0) {
        console.log(`  ✓ Both shops have the same set of keys (${inBoth.length} shared)`);
      } else {
        if (onlyInA.length > 0) {
          console.log(`  ⚠ Only in ${a!.slug} (${onlyInA.length}):`);
          for (const k of onlyInA) console.log(`      - ${k}`);
        }
        if (onlyInB.length > 0) {
          console.log(`  ⚠ Only in ${b!.slug} (${onlyInB.length}):`);
          for (const k of onlyInB) console.log(`      - ${k}`);
        }
        if (inBoth.length > 0) {
          console.log(`  ✓ Shared (${inBoth.length}): ${inBoth.join(", ")}`);
        }
      }
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
