/**
 * Minimal Stripe client for Collective memberships - plain fetch with
 * form encoding, no SDK dependency. All calls no-op-throw when
 * STRIPE_SECRET_KEY is unset so callers can degrade gracefully.
 */

const CRM_BASE_URL = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

async function stripePost(path: string, params: Record<string, string>) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe not configured");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`stripe ${path}: ${data.error?.message ?? res.status}`);
  return data;
}

/** Live price ids created by scripts/setup-stripe.ts (LIVE mode). */
export const STRIPE_PRICE_IDS: Record<string, string> = {
  "Coupe / Hatchback": "price_1TsyzDLHAxMRdXS4a71mxDIw",
  "Sedan / Wagon": "price_1TsyzELHAxMRdXS44BO3RXUh",
  "Small / Medium SUV": "price_1TsyzFLHAxMRdXS4gV5vHcu0",
  "Large SUV / Ute": "price_1TsyzFLHAxMRdXS4iAImRBta",
};

/**
 * Hosted Checkout for a membership subscription. client_reference_id
 * carries the membership id so the webhook can flip pending → active.
 */
export async function createMembershipCheckout(args: {
  membershipId: string;
  sizeTier: string;
  email: string;
}): Promise<string | null> {
  const price = STRIPE_PRICE_IDS[args.sizeTier];
  if (!price || !stripeConfigured()) return null;
  const session = await stripePost("checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    client_reference_id: args.membershipId,
    customer_email: args.email,
    "automatic_tax[enabled]": "true",
    success_url: `${CRM_BASE_URL}/account?welcome=collective`,
    cancel_url: `${CRM_BASE_URL}/account`,
    "subscription_data[metadata][membership_id]": args.membershipId,
  });
  return (session.url as string) ?? null;
}

/** Hosted billing portal (card update / cancel) for an active member. */
export async function createBillingPortalSession(stripeCustomerId: string): Promise<string | null> {
  if (!stripeConfigured()) return null;
  const session = await stripePost("billing_portal/sessions", {
    customer: stripeCustomerId,
    return_url: `${CRM_BASE_URL}/account`,
  });
  return (session.url as string) ?? null;
}
