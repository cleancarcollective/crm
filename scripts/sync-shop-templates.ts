/**
 * Sync per-shop config (email_templates, lead_email_templates, pricing) so
 * core functionality stays identical across shops. Per-shop tweaks are
 * preserved via the {{shop_name}} variable — the template body uses it,
 * and the renderer fills it from the shop record at send time. So a
 * single template body works for both Christchurch and Wellington.
 *
 * Usage:
 *   npx tsx scripts/sync-shop-templates.ts                  # dry-run (christchurch → wellington)
 *   npx tsx scripts/sync-shop-templates.ts --apply          # actually mutate
 *   npx tsx scripts/sync-shop-templates.ts --from <slug> --to <slug>
 *
 * What it does:
 *   1. Pull every config row from the SOURCE shop.
 *   2. Normalise hardcoded shop names → {{shop_name}} placeholder.
 *   3. UPSERT the normalised row into the SOURCE shop (so its body is clean).
 *   4. UPSERT into the DEST shop (creating it if missing, updating if drift).
 *
 * Result: source and dest end up with byte-identical body_template /
 * subject_template — only the shop_id differs. Per-shop differences flow
 * through {{shop_name}}, {{shop_phone}}, etc. at render time.
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
function argValue(flag: string, fallback: string) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const FROM_SLUG = argValue("--from", "christchurch");
const TO_SLUG = argValue("--to", "wellington");

/**
 * Replace any hard-coded shop-specific strings with {{shop_name}} so a
 * single template body renders correctly for any shop.
 *
 * Patterns covered:
 *   - "Clean Car Collective Christchurch" → "Clean Car Collective {{shop_short}}"
 *   - "Clean Car Collective Wellington" → "Clean Car Collective {{shop_short}}"
 *
 * Safer: replace whole brand-shop strings with {{shop_name}} variable
 * (which the renderer already supports — see sendBookingEmail.ts:287).
 */
function normaliseShopStrings(text: string | null | undefined): string | null | undefined {
  if (text === null || text === undefined) return text;
  return text
    .replaceAll("Clean Car Collective Christchurch", "{{shop_name}}")
    .replaceAll("Clean Car Collective Wellington", "{{shop_name}}");
}

type ConfigRule = {
  table: string;
  /** Column(s) that uniquely identify a row WITHIN a shop. */
  uniqueKeys: string[];
  /** Columns whose strings should be normalised (shop-name swap). */
  textFields: string[];
};

const RULES: ConfigRule[] = [
  {
    table: "email_templates",
    uniqueKeys: ["key"],
    textFields: ["subject_template", "body_template"],
  },
  {
    table: "lead_email_templates",
    uniqueKeys: ["template_key", "variant"],
    textFields: ["subject_template", "body_template"],
  },
  {
    table: "pricing",
    uniqueKeys: ["service_name", "size"],
    textFields: [],
  },
];

async function syncTable(rule: ConfigRule, fromShopId: string, toShopId: string) {
  const supabase = getSupabaseAdminClient();

  const { data: srcRows, error } = await supabase
    .from(rule.table)
    .select("*")
    .eq("shop_id", fromShopId);
  if (error) throw error;

  const { data: dstRows } = await supabase
    .from(rule.table)
    .select("*")
    .eq("shop_id", toShopId);

  const dstIndex = new Map<string, any>();
  for (const r of (dstRows ?? []) as any[]) {
    const k = rule.uniqueKeys.map((c) => String(r[c])).join("::");
    dstIndex.set(k, r);
  }

  let inserts = 0;
  let updates = 0;
  let unchanged = 0;
  let normalisedSource = 0;

  for (const srcRow of (srcRows ?? []) as any[]) {
    // Build normalised payload (strip shop-specific copy)
    const payload: Record<string, any> = { ...srcRow };
    delete payload.id;
    delete payload.created_at;
    delete payload.updated_at;
    payload.shop_id = toShopId;

    let needsSourceNormalisation = false;
    for (const field of rule.textFields) {
      const original = srcRow[field];
      const normalised = normaliseShopStrings(original);
      if (normalised !== original) needsSourceNormalisation = true;
      payload[field] = normalised;
    }

    // 1. Update source row in-place if it had hardcoded shop name
    if (needsSourceNormalisation) {
      normalisedSource++;
      if (APPLY) {
        const updateBody: Record<string, any> = {};
        for (const field of rule.textFields) {
          updateBody[field] = normaliseShopStrings(srcRow[field]);
        }
        await supabase.from(rule.table).update(updateBody).eq("id", srcRow.id);
      }
    }

    // 2. Upsert into destination
    const key = rule.uniqueKeys.map((c) => String(srcRow[c])).join("::");
    const existing = dstIndex.get(key);
    if (!existing) {
      inserts++;
      if (APPLY) {
        await supabase.from(rule.table).insert(payload);
      }
    } else {
      // Compare text fields after normalisation
      const drifted = rule.textFields.some(
        (f) => normaliseShopStrings(srcRow[f]) !== existing[f]
      );
      if (drifted) {
        updates++;
        if (APPLY) {
          const updateBody: Record<string, any> = {};
          for (const field of rule.textFields) {
            updateBody[field] = normaliseShopStrings(srcRow[field]);
          }
          // Also sync any non-text fields except shop_id and id and uniqueKeys
          for (const [k, v] of Object.entries(payload)) {
            if (k === "shop_id" || k === "id") continue;
            if (rule.uniqueKeys.includes(k)) continue;
            if (rule.textFields.includes(k)) continue;
            updateBody[k] = v;
          }
          await supabase.from(rule.table).update(updateBody).eq("id", existing.id);
        }
      } else {
        unchanged++;
      }
    }
  }

  return { table: rule.table, inserts, updates, unchanged, normalisedSource, total: (srcRows ?? []).length };
}

async function main() {
  const supabase = getSupabaseAdminClient();
  const { data: shops } = await supabase.from("shops").select("id, slug, name");
  if (!shops) throw new Error("No shops");

  const fromShop = shops.find((s) => s.slug === FROM_SLUG);
  const toShop = shops.find((s) => s.slug === TO_SLUG);
  if (!fromShop) throw new Error(`Shop --from=${FROM_SLUG} not found`);
  if (!toShop) throw new Error(`Shop --to=${TO_SLUG} not found`);

  console.log(`\n${APPLY ? "Applying" : "Dry-run"}: ${fromShop.slug} → ${toShop.slug}\n`);

  for (const rule of RULES) {
    const result = await syncTable(rule, fromShop.id, toShop.id);
    console.log(`  ${rule.table.padEnd(25)} ${result.inserts} insert · ${result.updates} update · ${result.unchanged} unchanged · ${result.normalisedSource} normalised in source`);
  }

  if (!APPLY) {
    console.log("\n(dry run — pass --apply to actually mutate both shops)");
  } else {
    console.log("\n✓ Sync complete.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
