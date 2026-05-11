import fs from "node:fs";
import nodePath from "node:path";
const path = nodePath;

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

async function main() {
  process.stdout.write("starting\n");
  const supabase = getSupabaseAdminClient();
  process.stdout.write("got supabase\n");
  const { data: shop, error: shopErr } = await supabase.from("shops").select("id, slug").eq("slug", "wellington").single();
  if (shopErr) throw shopErr;
  if (!shop) throw new Error("no wellington");
  console.log("shop id:", shop.id);
  const { data, error } = await supabase
    .from("lead_email_templates")
    .select("template_key, variant, subject, body_text, shop_id")
    .eq("shop_id", shop.id)
    .order("template_key");
  if (error) {
    console.error("query error:", error);
    throw error;
  }
  console.log("rows returned:", (data ?? []).length);

  const out: string[] = [];
  for (const t of (data ?? []) as any[]) {
    out.push(`== ${t.template_key} / variant=${t.variant ?? "-"} ==`);
    out.push(`SUBJECT: ${t.subject}`);
    out.push(`--- body ---`);
    out.push(String(t.body_text));
    out.push("");
  }
  fs.writeFileSync("/tmp/lead-templates-dump.txt", out.join("\n"));
  console.log(`Wrote ${(data ?? []).length} templates to /tmp/lead-templates-dump.txt`);
}
main().catch((e) => { console.error(e); process.exit(1); });
