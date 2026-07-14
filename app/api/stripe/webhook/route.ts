/**
 * Stripe Billing webhook for Collective memberships.
 *
 * Wired and safe to deploy BEFORE Stripe is configured: without
 * STRIPE_WEBHOOK_SECRET the route answers 503 and does nothing.
 *
 * Handled events:
 *   checkout.session.completed  → membership pending → active
 *                                 (client_reference_id = membership id)
 *   invoice.paid                → accrue the monthly credit
 *   invoice.payment_failed      → status past_due (accrual pauses)
 *   customer.subscription.deleted → status cancelled
 *
 * Signature verification is implemented manually (HMAC-SHA256 over
 * `${timestamp}.${payload}` per Stripe's spec) so we don't need the
 * stripe SDK dependency until the full checkout flow lands.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { accrueMonthlyCredit } from "@/lib/portal/membership";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function verifyStripeSignature(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=") as [string, string])
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  // 5-minute tolerance against replay.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const obj = event.data.object;

  if (event.type === "checkout.session.completed") {
    const membershipId = obj.client_reference_id as string | null;
    if (membershipId) {
      await supabase
        .from("memberships")
        .update({
          status: "active",
          stripe_customer_id: (obj.customer as string) ?? null,
          stripe_subscription_id: (obj.subscription as string) ?? null,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", membershipId);
    }
  } else if (event.type === "invoice.paid") {
    const subId = (obj.subscription as string) ?? null;
    const invoiceId = (obj.id as string) ?? "unknown";
    if (subId) {
      const { data: m } = await supabase
        .from("memberships")
        .select("id, contact_id, shop_id, vehicle_id, size_tier, monthly_fee_cents, monthly_credit_cents, status, started_at, last_accrued_at")
        .eq("stripe_subscription_id", subId)
        .maybeSingle();
      if (m) {
        if (m.status === "past_due") {
          await supabase.from("memberships").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", m.id);
        }
        await accrueMonthlyCredit(m as Parameters<typeof accrueMonthlyCredit>[0], `Collective monthly credit (stripe ${invoiceId})`);
      }
    }
  } else if (event.type === "invoice.payment_failed") {
    const subId = (obj.subscription as string) ?? null;
    if (subId) {
      await supabase
        .from("memberships")
        .update({ status: "past_due", updated_at: new Date().toISOString() })
        .eq("stripe_subscription_id", subId)
        .neq("status", "cancelled");
    }
  } else if (event.type === "customer.subscription.deleted") {
    const subId = (obj.id as string) ?? null;
    if (subId) {
      await supabase
        .from("memberships")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("stripe_subscription_id", subId);
    }
  }

  return NextResponse.json({ received: true });
}
