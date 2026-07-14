/**
 * One-shot Stripe setup for Collective memberships. Idempotent - safe
 * to re-run; finds existing objects by metadata/URL before creating.
 *
 *   1. Product + monthly Price per size tier (ex-GST, tax exclusive)
 *   2. Webhook endpoint -> prints the signing secret for Vercel
 *
 * Usage: npx tsx scripts/setup-stripe.ts
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

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) { console.error("STRIPE_SECRET_KEY missing"); process.exit(1); }

const TIERS: Array<{ tier: string; feeCents: number; creditCents: number }> = [
  { tier: "Coupe / Hatchback", feeCents: 10800, creditCents: 12500 },
  { tier: "Sedan / Wagon", feeCents: 11200, creditCents: 13000 },
  { tier: "Small / Medium SUV", feeCents: 11700, creditCents: 13500 },
  { tier: "Large SUV / Ute", feeCents: 12600, creditCents: 14500 },
];

const WEBHOOK_URL = "https://crm.cleancarcollective.co.nz/api/stripe/webhook";
const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.deleted",
];

async function stripe(pathname: string, params?: Record<string, string>, method = "POST") {
  const res = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    method: params || method === "POST" ? method : "GET",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${pathname}: ${data.error?.message ?? res.status}`);
  return data;
}

async function stripeGet(pathname: string) {
  const res = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${pathname}: ${data.error?.message ?? res.status}`);
  return data;
}

(async () => {
  console.log(`Mode: ${KEY!.startsWith("sk_live") ? "LIVE" : "TEST"}\n`);

  // ── Products + prices ────────────────────────────────────────────────
  const existingProducts = await stripeGet("products?limit=100&active=true");
  const priceIds: Record<string, string> = {};

  for (const t of TIERS) {
    let product = existingProducts.data.find(
      (p: { metadata?: { ccc_tier?: string } }) => p.metadata?.ccc_tier === t.tier
    );
    if (!product) {
      product = await stripe("products", {
        name: `The Collective — ${t.tier}`,
        description: `Clean Car Collective membership: $${(t.creditCents / 100).toFixed(0)}/mo detailing credit + member perks. Priced for ${t.tier}.`,
        "metadata[ccc_tier]": t.tier,
      });
      console.log(`created product  ${product.id}  (${t.tier})`);
    } else {
      console.log(`found product    ${product.id}  (${t.tier})`);
    }

    const prices = await stripeGet(`prices?product=${product.id}&active=true&limit=10`);
    let price = prices.data.find(
      (p: { unit_amount: number; recurring?: { interval: string }; currency: string }) =>
        p.unit_amount === t.feeCents && p.recurring?.interval === "month" && p.currency === "nzd"
    );
    if (!price) {
      price = await stripe("prices", {
        product: product.id,
        currency: "nzd",
        unit_amount: String(t.feeCents),
        "recurring[interval]": "month",
        tax_behavior: "exclusive",
        "metadata[ccc_tier]": t.tier,
      });
      console.log(`created price    ${price.id}  $${t.feeCents / 100}/mo ex-GST`);
    } else {
      console.log(`found price      ${price.id}  $${t.feeCents / 100}/mo ex-GST`);
    }
    priceIds[t.tier] = price.id;
  }

  // ── Webhook endpoint ─────────────────────────────────────────────────
  const hooks = await stripeGet("webhook_endpoints?limit=50");
  let hook = hooks.data.find((h: { url: string }) => h.url === WEBHOOK_URL);
  let hookSecretNote: string;
  if (!hook) {
    const params: Record<string, string> = { url: WEBHOOK_URL };
    WEBHOOK_EVENTS.forEach((ev, i) => { params[`enabled_events[${i}]`] = ev; });
    hook = await stripe("webhook_endpoints", params);
    hookSecretNote = hook.secret; // only returned at creation time
    console.log(`\ncreated webhook  ${hook.id} -> ${WEBHOOK_URL}`);
  } else {
    hookSecretNote = "(existing endpoint - secret shown only at creation; roll it in the dashboard if lost)";
    console.log(`\nfound webhook    ${hook.id} -> ${WEBHOOK_URL}`);
  }

  console.log("\n──────────────────────────────────────────────");
  console.log("STRIPE_PRICE_IDS map for lib/portal/membership.ts:\n");
  console.log(JSON.stringify(priceIds, null, 2));
  console.log("\nSTRIPE_WEBHOOK_SECRET for Vercel:");
  console.log(hookSecretNote);
  console.log("──────────────────────────────────────────────");
})();
