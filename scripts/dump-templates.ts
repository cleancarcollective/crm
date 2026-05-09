/**
 * Dump shop email_templates so we can see what's per-shop vs shared.
 * Run with: npx tsx scripts/dump-templates.ts <shop-slug>
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

async function main() {
  const slug = process.argv[2] ?? "christchurch";
  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase.from("shops").select("id, slug, name").eq("slug", slug).single();
  if (!shop) throw new Error(`No shop ${slug}`);
  const { data } = await supabase.from("email_templates").select("*").eq("shop_id", shop.id).order("key");
  for (const t of data ?? []) {
    console.log("==", (t as any).key, "==");
    console.log("subject:", (t as any).subject_template);
    console.log("--- body ---");
    console.log((t as any).body_template);
    console.log("");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
