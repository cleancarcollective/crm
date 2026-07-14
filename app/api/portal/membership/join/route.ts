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
import { createMembershipCheckout, stripeConfigured } from "@/lib/portal/stripe";
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

  // Already a member: active is idempotent success; pending gets a
  // FRESH checkout link so "complete setup" always works.
  const existing = await getMemberships(contacts.map((c) => c.id));
  if (existing.length > 0) {
    const m = existing[0];
    if (m.status === "pending" && stripeConfigured()) {
      try {
        const url = await createMembershipCheckout({ membershipId: m.id, sizeTier: m.size_tier, email });
        return corsJson({ ok: true, status: m.status, checkout_url: url });
      } catch (err) {
        console.error("checkout session for existing pending membership failed", err);
      }
    }
    return corsJson({ ok: true, status: m.status, checkout_url: null });
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

  // Hosted Stripe Checkout for the subscription. If session creation
  // fails (or Stripe is unconfigured), the signup still stands and the
  // team completes it manually.
  let checkoutUrl: string | null = null;
  if (stripeConfigured()) {
    try {
      checkoutUrl = await createMembershipCheckout({ membershipId: membership.id, sizeTier: tier, email });
    } catch (err) {
      console.error("membership checkout session failed", err);
    }
  }

  const name = primary.full_name || [primary.first_name, primary.last_name].filter(Boolean).join(" ") || email;

  // Email the customer - either their payment link, or (if Stripe is
  // down/unconfigured) a holding email so the "we'll email you" promise
  // on the thank-you screen is always kept.
  const credit = (pricing.creditCents / 100).toFixed(0);
  const fee = (pricing.feeCents / 100).toFixed(0);
  const bonusAmt = ((pricing.creditCents - pricing.feeCents) / 100).toFixed(0);
  try {
    if (checkoutUrl) {
      await sendViaGmailSmtp({
        From: "Clean Car Collective <hello@cleancarcollective.co.nz>",
        To: email,
        Subject: `Switch on your $${credit}/mo detailing credit - 2 minutes`,
        TextBody: `${primary.first_name ? `Hi ${primary.first_name},` : "Hi,"}

Welcome to the Collective. One quick step and your credit starts - set up your monthly payment (about 2 minutes, card or Apple/Google Pay):

${checkoutUrl}

From then on, $${credit} of detailing credit lands in your account every month for $${fee}/mo +GST - that's $${bonusAmt} extra, every month (15%+ bonus).

Get busy? No worries. Credit never expires - it stacks, so a couple of quiet months turns into a bigger detail when you're ready.

Cancel anytime. Banked credit stays yours.`,
        HtmlBody: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;">
<p>${primary.first_name ? `Hi ${primary.first_name},` : "Hi,"}</p>
<p>Welcome to the Collective. One quick step and your credit starts - set up your monthly payment (about 2 minutes, card or Apple/Google Pay).</p>
<p style="margin:22px 0;"><a href="${checkoutUrl}" style="display:inline-block;padding:14px 34px;background:#1a1713;color:#ffffff;font-weight:600;text-decoration:none;border-radius:12px;">Switch on my credit</a></p>
<p>From then on, <strong>$${credit} of detailing credit</strong> lands in your account every month for $${fee}/mo +GST - that's <strong>$${bonusAmt} extra, every month</strong> (15%+ bonus).</p>
<p>Get busy? No worries. Credit never expires - it stacks, so a couple of quiet months turns into a bigger detail when you're ready.</p>
<p style="color:#6f6860;font-size:13px;">Cancel anytime. Banked credit stays yours.</p>
</div>`,
        Metadata: { template_key: "collective-checkout-link", membership_id: membership.id },
      });
    } else {
      await sendViaGmailSmtp({
        From: "Clean Car Collective <hello@cleancarcollective.co.nz>",
        To: email,
        Subject: "You're in the Collective - we'll set you up",
        TextBody: `${primary.first_name ? `Hi ${primary.first_name},` : "Hi,"}

Your Collective signup is locked in - nothing to pay today. We'll be in touch within one business day to set up your monthly payment.

From then on, $${credit} of detailing credit lands in your account every month for $${fee}/mo +GST. It never expires and it stacks - skip a busy month and put it toward a bigger detail next time.

Cancel anytime. Banked credit stays yours.`,
        HtmlBody: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;">
<p>${primary.first_name ? `Hi ${primary.first_name},` : "Hi,"}</p>
<p>Your Collective signup is locked in - nothing to pay today. We'll be in touch within one business day to set up your monthly payment.</p>
<p>From then on, <strong>$${credit} of detailing credit</strong> lands in your account every month for $${fee}/mo +GST. It never expires and it stacks - skip a busy month and put it toward a bigger detail next time.</p>
<p style="color:#6f6860;font-size:13px;">Cancel anytime. Banked credit stays yours.</p>
</div>`,
        Metadata: { template_key: "collective-holding", membership_id: membership.id },
      });
    }
  } catch (err) {
    console.error("Collective customer email failed", err);
  }

  // Team notification.
  try {
    const { data: shop } = await supabase
      .from("shops")
      .select("id, slug, name, timezone")
      .eq("id", primary.shop_id)
      .single();
    if (shop) {
      const { team_email, from_line } = getShopContacts(shop);
      const lines = [
        `${name} wants to Join the Collective 🎉`,
        ``,
        `Tier: ${tier} - $${(pricing.feeCents / 100).toFixed(0)}/mo +GST → $${(pricing.creditCents / 100).toFixed(0)}/mo credit`,
        `Email: ${email}`,
        primary.phone ? `Phone: ${primary.phone}` : null,
        `Source: ${body.source ?? "portal"}`,
        ``,
        checkoutUrl
          ? `They've been sent a Stripe payment link - the membership activates automatically once they pay. No action needed unless they stall (nudge them or call).`
          : `Stripe link couldn't be created - contact them to set up payment, then mark the membership active in the CRM.`,
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

  return corsJson({ ok: true, status: "pending", checkout_url: checkoutUrl });
}
