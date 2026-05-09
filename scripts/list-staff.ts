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
  const { data } = await supabase
    .from("staff_users")
    .select("id, email, name, created_at, shop:shops(slug, name)");
  console.log("Staff users:");
  for (const u of data ?? []) {
    const shop = (u as any).shop ?? {};
    console.log(`  ${u.email.padEnd(40)} ${u.name?.padEnd(15) ?? "—"} shop: ${shop.slug ?? "—"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
