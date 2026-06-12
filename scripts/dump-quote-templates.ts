/**
 * Dump live email_templates rows (per shop) so you can audit what's
 * actually being sent for lead auto-respond + manual quote sends.
 *
 * Also includes the static lead-confirmation template (the "we've got
 * your enquiry" email - that one is hard-coded in code, not DB).
 *
 * Usage: npx tsx scripts/dump-quote-templates.ts
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

(async () => {
  const supabase = getSupabaseAdminClient();

  const { data: shops } = await supabase.from("shops").select("id, slug, name").order("slug");
  // Dump everything - we'll figure out column names from the first row.
  const { data: templates, error } = await supabase
    .from("lead_email_templates")
    .select("*");

  if (error) {
    console.error("query failed:", error);
    process.exit(1);
  }

  const shopBySlug = new Map(shops?.map((s) => [s.id, s]) ?? []);

  console.log("=".repeat(80));
  console.log("LIVE email_templates ROWS");
  console.log("=".repeat(80));

  if (!templates || templates.length === 0) {
    console.log("(no rows)");
  } else {
    console.log("Detected columns:", Object.keys(templates[0]).join(", "));
    console.log();

    // Group by shop, then dump every column. Body column might be
    // `body_text`, `body`, `body_html`, etc.
    const grouped: Record<string, typeof templates> = {};
    for (const t of templates) {
      const slug = shopBySlug.get((t as any).shop_id)?.slug ?? "(unknown / shared)";
      grouped[slug] = grouped[slug] ?? [];
      grouped[slug]!.push(t);
    }

    for (const slug of Object.keys(grouped).sort()) {
      console.log(`\n\n########## SHOP: ${slug} ##########\n`);
      for (const t of grouped[slug]!) {
        console.log("-".repeat(80));
        for (const [k, v] of Object.entries(t)) {
          if (typeof v === "string" && v.length > 80) {
            console.log(`${k}:`);
            console.log(v);
            console.log();
          } else {
            console.log(`${k}: ${JSON.stringify(v)}`);
          }
        }
      }
    }
  }

  console.log("\n\n" + "=".repeat(80));
  console.log("STATIC: lib/email/sendLeadConfirmationEmail.ts");
  console.log("(the 'we've received your enquiry' auto-response)");
  console.log("=".repeat(80));
  console.log("Hard-coded in lib/email/sendLeadConfirmationEmail.ts - not in DB.");
  console.log("Subject:  We've received your enquiry - Clean Car Collective");
  console.log("Body (text):");
  console.log(`
Hi {FirstName},

Thanks for reaching out to {shop name}. We've received your enquiry and one of our team will be in touch shortly with a quote.

YOUR ENQUIRY
Service: {service requested}
Vehicle: {vehicle label}

Questions? Contact us:
{shop phone}
{shop reply email}

Clean Car Collective - {shop name}
cleancarcollective.co.nz
`);
})();
