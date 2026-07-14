/**
 * POST { email, size_tier?, source? } → { ok, status, checkout_url }
 *
 * Captures a "Join the Collective" signup. Creates a pending
 * membership against the customer's contact record and notifies the
 * shop team. Once Stripe is configured this also returns a hosted
 * Checkout URL; until then checkout_url is null and the team
 * completes setup by invoice (pending → active manually).
 *
 * CORS-open for the booking forms' thank-you screens; called from the
 * portal too. Requires the email to already exist as a contact (the
 * booking intake upserts it before this fires).
 */

import { NextRequest } from "next/server";

import { getShopContacts } from "@/lib/email/shopContacts";
import { sendViaGmailSmtp } from "@/lib/email/smtpClient";
import { corsJson, corsPreflight } from "@/lib/portal/cors";
import { getMemberships, pricingForSize, DEFAULT_TIER, MEMBERSHIP_PRICING } from "@/lib/portal/membership";
import { getPortalContacts } from "@/lib/portal/session";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  let body: { email?: string; size_tier?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return corsJson({ error: "Invalid request" }, { status: 400 });
  }
  const email = (body.email ?? "").toLowerCase().trim();
  if (!email || !email.includes("@")) {
    return corsJson({ error: "Enter a valid email address" }, { status: 400 });
  }

  const contacts = await getPortalContacts(email);
  if (contacts.length === 0) {
    // No contact yet (shouldn't happen post-booking) - silent ok so the
    // thank-you screen never shows an error for this.
    return corsJson({ ok: true, status: "pending", checkout_url: null });
  }

  // Already a member (pending or active): idempotent success.
  const existing = await getMemberships(contacts.map((c) => c.id));
  if (existing.length > 0) {
    return corsJson({ ok: true, status: existing[0].status, checkout_url: null });
  }

  const supabase = getSupabaseAdminClient();
  const primary = contacts[0];

  // Size tier: explicit param, else the contact's single vehicle, else default.
  let sizeTier = body.size_tier && MEMBERSHIP_PRICING[body.size_tier] ? body.size_tier : null;
  let vehicleId: string | null = null;
  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, size")
    .in("contact_id", contacts.map((c) => c.id));
  if (!sizeTier && vehicles?.length === 1 && vehicles[0].size && MEMBERSHIP_PRICING[vehicles[0].size]) {
    sizeTier = vehicles[0].size;
    vehicleId = vehicles[0].id;
  }
  if (!vehicleId && sizeTier) {
    vehicleId = vehicles?.find((v) => v.size === sizeTier)?.id ?? null;
  }
  const tier = sizeTier ?? DEFAULT_TIER;
  const pricing = pricingForSize(tier);

  const { data: membership, error } = await supabase
    .from("memberships")
    .insert({
      contact_id: primary.id,
      shop_id: primary.shop_id,
      vehicle_id: vehicleId,
      size_tier: tier,
      monthly_fee_cents: pricing.feeCents,
      monthly_credit_cents: pricing.creditCents,
      status: "pending",
      source: (body.source ?? "portal").slice(0, 60),
    })
    .select("id")
    .single();

  if (error) {
    console.error("membership insert failed", error);
    return corsJson({ error: "Could not save signup" }, { status: 500 });
  }

  // Team notification - until Stripe lands, staff complete the signup.
  try {
    const { data: shop } = await supabase
      .from("shops")
      .select("id, slug, name, timezone")
      .eq("id", primary.shop_id)
      .single();
    if (shop) {
      const { team_email, from_line } = getShopContacts(shop);
      const name = primary.full_name || [primary.first_name, primary.last_name].filter(Boolean).join(" ") || email;
      const lines = [
        `${name} wants to Join the Collective 🎉`,
        ``,
        `Tier: ${tier} - $${(pricing.feeCents / 100).toFixed(0)}/mo +GST → $${(pricing.creditCents / 100).toFixed(0)}/mo credit`,
        `Email: ${email}`,
        primary.phone ? `Phone: ${primary.phone}` : null,
        `Source: ${body.source ?? "portal"}`,
        ``,
        `Stripe billing isn't wired yet - contact them to set up payment,`,
        `then mark the membership active and the monthly credit will accrue.`,
        `Membership id: ${membership.id}`,
      ].filter(Boolean) as string[];
      await sendViaGmailSmtp({
        From: from_line,
        To: team_email,
        Subject: `⭐ Collective signup: ${name}`,
        TextBody: lines.join("\n"),
        HtmlBody: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;white-space:pre-wrap;">${lines.join("\n").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`,
        Metadata: { template_key: "collective-signup", membership_id: membership.id },
      });
    }
  } catch (err) {
    console.error("Collective signup team notification failed", err);
  }

  // TODO(stripe): create a Checkout Session here and return its URL.
  return corsJson({ ok: true, status: "pending", checkout_url: null });
}
