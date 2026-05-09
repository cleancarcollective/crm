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

async function main() {
  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("slug", "wellington").single();
  if (!shop) throw new Error("no wellington");

  const { data: leads } = await supabase
    .from("leads")
    .select("id, source, status, service_requested, created_at, contact:contacts(first_name, last_name, email, phone)")
    .eq("shop_id", shop.id)
    .order("created_at", { ascending: false });

  console.log(`Wellington leads (${leads?.length ?? 0}):\n`);
  for (const l of leads ?? []) {
    const c = (l as any).contact ?? {};
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
    console.log(`${l.created_at.slice(0, 16)}  ${l.source.padEnd(28)}  ${l.status.padEnd(15)}  ${name}  ${c.email ?? "—"}  ${c.phone ?? "—"}`);
    if (l.service_requested) console.log(`  service: ${l.service_requested}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
