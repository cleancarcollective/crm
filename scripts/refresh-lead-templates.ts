/**
 * Push current TEMPLATE_DEFAULTS into the lead_email_templates table for
 * every shop. Idempotent: re-run anytime after editing
 * lib/autorespond/templateDefaults.ts.
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

import { TEMPLATE_DEFAULTS } from "@/lib/autorespond/templateDefaults";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

async function main() {
  const supabase = getSupabaseAdminClient();
  const { data: shops } = await supabase.from("shops").select("id, slug");
  if (!shops) throw new Error("No shops");

  for (const shop of shops) {
    for (const def of TEMPLATE_DEFAULTS) {
      const { error } = await supabase
        .from("lead_email_templates")
        .update({
          subject: def.subject,
          body_text: def.body_text,
          name: def.name,
        })
        .eq("shop_id", shop.id)
        .eq("template_key", def.template_key)
        .eq("variant", def.variant);
      if (error) throw error;
    }
    console.log(`✓ refreshed ${TEMPLATE_DEFAULTS.length} lead_email_templates for ${shop.slug}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
