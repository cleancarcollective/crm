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

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const NEEDLES = ["make-a-booking", "/booking", "cleancarcollective.co.nz/", "https://", "http://"];

async function main() {
  const supabase = getSupabaseAdminClient();

  for (const table of ["lead_email_templates", "email_templates", "sms_templates"] as const) {
    const { data, error } = await supabase.from(table).select("*");
    if (error) { console.error(table, error.message); continue; }
    console.log(`\n=== ${table} (${(data ?? []).length} rows) ===`);
    for (const row of (data ?? []) as any[]) {
      const id = row.id;
      const key = row.template_key ?? row.key;
      const variant = row.variant ?? "";
      const fields = ["subject", "body_text", "subject_template", "body_template"];
      for (const f of fields) {
        const v = row[f];
        if (typeof v !== "string") continue;
        const hits = NEEDLES.filter((n) => v.toLowerCase().includes(n));
        if (hits.length > 0) {
          console.log(`  ⚠ ${key}/${variant} [${f}]: ${hits.join(", ")}`);
          // Show the line that contains the needle
          for (const line of v.split("\n")) {
            if (NEEDLES.some((n) => line.toLowerCase().includes(n))) {
              console.log(`      → ${line.trim()}`);
            }
          }
        }
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
