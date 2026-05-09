/**
 * Update DB sms_templates to match the latest defaults in
 * lib/sms/smsTemplateDefaults.ts. Idempotent — re-run anytime defaults
 * change. Mirrors to all shops.
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

import { SMS_TEMPLATE_DEFAULTS } from "@/lib/sms/smsTemplateDefaults";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

async function main() {
  const supabase = getSupabaseAdminClient();
  const { data: shops } = await supabase.from("shops").select("id, slug");
  if (!shops) throw new Error("No shops");

  for (const shop of shops) {
    for (const def of SMS_TEMPLATE_DEFAULTS) {
      const { error } = await supabase
        .from("sms_templates")
        .update({ body_text: def.body_text, name: def.name })
        .eq("shop_id", shop.id)
        .eq("template_key", def.template_key);
      if (error) throw error;
    }
    console.log(`✓ refreshed ${SMS_TEMPLATE_DEFAULTS.length} sms_templates for ${shop.slug}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
