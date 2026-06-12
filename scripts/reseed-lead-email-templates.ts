/**
 * Push TEMPLATE_DEFAULTS into lead_email_templates for every shop.
 *
 * The live renderer (lib/autorespond/templateRenderer.ts) reads DB
 * rows first and only falls back to TEMPLATE_DEFAULTS when no row
 * exists. So editing templateDefaults.ts alone has no effect on
 * production - this script syncs the DB to match.
 *
 * Updates rows matched on (shop_id, template_key, variant). Inserts
 * if missing. Leaves untouched anything we don't have a default for.
 *
 * Usage: npx tsx scripts/reseed-lead-email-templates.ts
 */

import fs from "node:fs";
import path from "node:path";
function loadEnv(f: string) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf-8").split("\n")) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const e = t.indexOf("=");
    if (e === -1) continue;
    const k = t.slice(0, e).trim();
    let v = t.slice(e + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(".env.local"); loadEnv(".env.vercel.local");

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { TEMPLATE_DEFAULTS } from "@/lib/autorespond/templateDefaults";

(async () => {
  const supabase = getSupabaseAdminClient();

  const { data: shops } = await supabase.from("shops").select("id, slug, name").order("slug");
  if (!shops || shops.length === 0) {
    console.error("No shops found");
    process.exit(1);
  }

  let updated = 0;
  let inserted = 0;

  for (const shop of shops) {
    for (const tpl of TEMPLATE_DEFAULTS) {
      const { data: existing } = await supabase
        .from("lead_email_templates")
        .select("id")
        .eq("shop_id", shop.id)
        .eq("template_key", tpl.template_key)
        .eq("variant", tpl.variant)
        .maybeSingle();

      const payload = {
        shop_id: shop.id,
        template_key: tpl.template_key,
        variant: tpl.variant,
        name: tpl.name,
        subject: tpl.subject,
        body_text: tpl.body_text,
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        const { error } = await supabase.from("lead_email_templates").update(payload).eq("id", existing.id);
        if (error) {
          console.error(`update failed ${shop.slug}/${tpl.template_key}:`, error);
          process.exit(1);
        }
        updated++;
        console.log(`  updated ${shop.slug} / ${tpl.template_key}`);
      } else {
        const { error } = await supabase.from("lead_email_templates").insert(payload);
        if (error) {
          console.error(`insert failed ${shop.slug}/${tpl.template_key}:`, error);
          process.exit(1);
        }
        inserted++;
        console.log(`  inserted ${shop.slug} / ${tpl.template_key}`);
      }
    }
  }

  console.log(`\nDone. Updated ${updated}, inserted ${inserted}.`);
})();
