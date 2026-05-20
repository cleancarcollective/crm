/**
 * Mint a signed lock-in-recurring URL for any completed booking, so we
 * can preview the customer-facing /lock-in-recurring page without firing
 * an actual touchpoint email.
 *
 * Usage:
 *   npx tsx scripts/mint-lockin-url.ts <booking_id> <shop_id> [cadence]
 *
 * cadence defaults to 2 (months).
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
loadEnv(".env.local");
loadEnv(".env.vercel.local");

import { signActionToken } from "@/lib/auth/signedTokens";

const [bookingId, shopId, cadenceRaw = "2"] = process.argv.slice(2);
if (!bookingId || !shopId) {
  console.error("Usage: npx tsx scripts/mint-lockin-url.ts <booking_id> <shop_id> [cadence]");
  process.exit(1);
}
const cadence = Number(cadenceRaw);
if (![2, 3, 4].includes(cadence)) {
  console.error("cadence must be 2, 3, or 4");
  process.exit(1);
}

const token = signActionToken(
  { a: "lock_in_recurring", r: bookingId, s: shopId },
  30 * 24 * 60 * 60
);

const base = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";
console.log(`${base}/lock-in-recurring?token=${encodeURIComponent(token)}&cadence=${cadence}`);
