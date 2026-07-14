/**
 * Upsell notifications: send an offer to the customer (SMS primary,
 * email fallback) and notify the shop team when a customer responds.
 */

import type { ShopRecord } from "@/lib/dashboard/types";
import { getShopContacts } from "@/lib/email/shopContacts";
import { sendViaGmailSmtp } from "@/lib/email/smtpClient";
import { createLoginToken } from "@/lib/portal/session";
import { createShortUrl } from "@/lib/shortUrl";
import { sendTnzSms } from "@/lib/sms/tnzClient";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const CRM_BASE_URL = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";

function money(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

async function loadShop(shopId: string | null): Promise<ShopRecord | null> {
  if (!shopId) return null;
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase.from("shops").select("id, slug, name, timezone").eq("id", shopId).maybeSingle();
  return (data as ShopRecord) ?? null;
}

/**
 * Send an upsell offer to the customer. Mints a one-time auto-login link
 * to the offer page. Returns which channel actually delivered it.
 */
export async function sendOfferToCustomer(args: {
  offerId: string;
  email: string;
  phone: string | null;
  firstName: string | null;
  shopId: string | null;
  itemCount: number;
}): Promise<"sms" | "email" | "none"> {
  const token = await createLoginToken(args.email);
  const next = encodeURIComponent(`/account/upsell/${args.offerId}`);
  const fullUrl = `${CRM_BASE_URL}/account/verify?token=${token}&next=${next}`;
  const link = await createShortUrl({ fullUrl, shopId: args.shopId, purpose: "upsell" });

  const hi = args.firstName ? `Hi ${args.firstName}, ` : "Hi, ";
  const noticed = args.itemCount === 1 ? "something we think is" : "a few things we think are";
  const pkg = args.itemCount === 1 ? "a recommended package" : "some recommended packages";
  const smsBody = `${hi}we were inspecting your vehicle and noticed ${noticed} worth checking out during your detail. Tap to see the photos we uploaded and ${pkg}: ${link}`;

  if (args.phone) {
    const res = await sendTnzSms(args.phone, smsBody);
    if (res.success) return "sms";
    console.error("upsell SMS failed, falling back to email", res.error);
  }

  // Email fallback.
  const shop = await loadShop(args.shopId);
  const { from_line } = getShopContacts(shop ?? ({ slug: "wellington" } as ShopRecord));
  try {
    await sendViaGmailSmtp({
      From: from_line,
      To: args.email,
      Subject: "A few things we noticed on your car",
      TextBody: `${hi.trim()}

We were inspecting your vehicle and noticed ${noticed} worth checking out during your detail. Tap below to see the photos we uploaded and ${pkg} - add anything to your booking with one tap:

${link}

No pressure, and nothing changes unless you tap add.`,
      HtmlBody: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;">
<p>${hi.trim()}</p>
<p>We were inspecting your vehicle and noticed ${noticed} worth checking out during your detail. Tap below to see the photos we uploaded and ${pkg}.</p>
<p style="margin:22px 0;"><a href="${link}" style="display:inline-block;padding:14px 34px;background:#1a1713;color:#ffffff;font-weight:600;text-decoration:none;border-radius:12px;">See what we found</a></p>
<p style="color:#6f6860;font-size:13px;">No pressure - nothing changes unless you tap add.</p>
</div>`,
      Metadata: { template_key: "upsell-offer", offer_id: args.offerId },
    });
    return "email";
  } catch (err) {
    console.error("upsell email fallback failed", err);
    return "none";
  }
}

/** Notify the shop team that a customer accepted or declined an item. */
export async function notifyTeamOfResponse(args: {
  shopId: string;
  contactName: string;
  itemTitle: string;
  priceCents: number;
  durationMin: number;
  accepted: boolean;
  bookingId: string | null;
}): Promise<void> {
  const shop = await loadShop(args.shopId);
  if (!shop) return;
  const { team_email, from_line } = getShopContacts(shop);
  const bookingLink = args.bookingId ? `${CRM_BASE_URL}/bookings/${args.bookingId}` : CRM_BASE_URL;

  const subject = args.accepted
    ? `✅ Upsell accepted: ${args.contactName} - ${args.itemTitle}`
    : `Upsell declined: ${args.contactName} - ${args.itemTitle}`;
  const lines = args.accepted
    ? [
        `${args.contactName} accepted an upsell 🎉`,
        ``,
        `${args.itemTitle} - ${money(args.priceCents)}${args.durationMin ? ` (~${args.durationMin} min extra)` : ""}`,
        `It's been added to their booking and the price updated.`,
        args.durationMin ? `Heads up: this adds about ${args.durationMin} min - check it still fits the slot.` : ``,
        ``,
        `Booking: ${bookingLink}`,
      ]
    : [
        `${args.contactName} declined: ${args.itemTitle}.`,
        ``,
        `Booking: ${bookingLink}`,
      ];
  const body = lines.filter((l) => l !== null).join("\n");

  try {
    await sendViaGmailSmtp({
      From: from_line,
      To: team_email,
      Subject: subject,
      TextBody: body,
      HtmlBody: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;white-space:pre-wrap;">${body
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</div>`,
      Metadata: { template_key: "upsell-response", booking_id: args.bookingId ?? "" },
    });
  } catch (err) {
    console.error("upsell team notification failed", err);
  }
}
