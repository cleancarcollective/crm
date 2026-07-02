/**
 * Post-detail recurring-discount touchpoint emails (Phase B).
 *
 * One renderer covers all 4 touchpoints — copy varies by featured cadence
 * + featured discount %. Inline HTML, same shell pattern as
 * sendSeriesConfirmation.ts.
 *
 * Each email links to /lock-in-recurring?token=<signed> (Phase C page).
 * Token: action='lock_in_recurring', resource = booking_id, 30-day expiry.
 * Payload carries the featured cadence so the page can pre-select it.
 */

import { formatCurrency } from "@/lib/dashboard/format";
import { signActionToken } from "@/lib/auth/signedTokens";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { getShopContacts } from "@/lib/email/shopContacts";
import { sendViaGmailSmtp } from "@/lib/email/smtpClient";
import type { ShopRecord } from "@/lib/dashboard/types";
import type { TouchpointKey } from "@/lib/bookings/postDetailTouchpoints";

const CRM_BASE_URL = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";

type Cadence = 1 | 3 | 6;

type TouchpointEmailArgs = {
  shop: ShopRecord;
  bookingId: string;
  contact: {
    firstName: string | null;
    email: string;
  };
  serviceName: string;
  basePrice: number | null;
  touchpointKey: TouchpointKey;
  featuredCadenceMonths: Cadence;
  featuredDiscountPercent: number;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function subjectFor(key: TouchpointKey, firstName: string): string {
  switch (key) {
    case "post_detail_recurring_offer_next_day":
      return `${firstName} - want to keep the car looking this fresh?`;
    case "post_detail_recurring_offer_6w":
      return `${firstName} - how's the car holding up?`;
    case "post_detail_recurring_offer_10w":
      return `Heads up ${firstName} - the 20% rate is about to disappear`;
    case "post_detail_recurring_offer_16w":
      return `${firstName} - last call before the car needs a proper deep clean`;
  }
}

function openerFor(key: TouchpointKey, _shopName: string): string {
  switch (key) {
    case "post_detail_recurring_offer_next_day":
      return `Hope you're loving how the car came out yesterday. If you'd like to keep that just-detailed feel going, we offer a regular detail rate that saves you up to 35% on every visit. No contracts - cancel or pause whenever.`;
    case "post_detail_recurring_offer_6w":
      return `It's been about 6 weeks since we sorted your car - usually the point where most cars start looking a bit tired again. If you'd like to stay on top of it, lock in a regular rate and we'll knock 35% off every visit. No commitment, cancel or pause whenever you like.`;
    case "post_detail_recurring_offer_10w":
      return `Quick one - you're heading into the 3-month window since we last sorted your car. If you want to keep things tidy, lock in a 3-monthly rate now and save 20% every visit. Heads up though: after this the 20% rate is gone and you'll be looking at the 10% tier from here on.`;
    case "post_detail_recurring_offer_16w":
      return `It's been about 4 months since we detailed your car - past this point most cars need a proper deep clean rather than a quick refresh. This is the last nudge from us. If you'd like to keep things on a schedule and avoid the big resets, lock in a 6-monthly rate and save 10% every visit.`;
  }
}

const ALL_CADENCES: Array<{ months: Cadence; label: string; discount: number }> = [
  { months: 1, label: "Every month", discount: 35 },
  { months: 3, label: "Every 3 months", discount: 20 },
  { months: 6, label: "Every 6 months", discount: 10 },
];

function priceLine(basePrice: number | null, discount: number): string | null {
  if (basePrice == null) return null;
  const discounted = basePrice * (1 - discount / 100);
  return `${formatCurrency(discounted)} per visit (${discount}% off ${formatCurrency(basePrice)})`;
}

export async function sendPostDetailOfferEmail(args: TouchpointEmailArgs) {
  const firstName = args.contact.firstName ?? "there";
  const subject = subjectFor(args.touchpointKey, firstName);
  const opener = openerFor(args.touchpointKey, args.shop.name);

  const cadenceRows = ALL_CADENCES.map((c) => {
    const line = priceLine(args.basePrice, c.discount);
    const isFeatured = c.months === args.featuredCadenceMonths;
    return { ...c, priceText: line, isFeatured };
  });

  // Deliberately plain, personal-note style: default font, no button, no
  // link, no branded shell. The original HTML template pattern-matched
  // straight into Gmail's Promotions tab (audited 2 Jul 2026) and
  // Promotions placement is as good as unseen. Conversion is reply-based:
  // the customer answers this email and staff set the series up in the CRM.
  const rateLines = cadenceRows.map((c) => {
    const rate = c.priceText ?? `${c.discount}% off every visit`;
    return `${c.label}: ${rate}${c.isFeatured ? " (most popular)" : ""}`;
  });

  const perksLine = `Every option includes free mobile service (worth $80 +GST) and priority booking slots.`;
  const replyCta = `Keen? Just reply to this email and we'll set it up for you.`;
  const closingLine = `No contracts, pause or cancel whenever you like.`;

  const textBody = [
    `Hi ${firstName},`,
    ``,
    opener,
    ``,
    `Here's what the regular rates look like:`,
    ``,
    ...rateLines.flatMap((l) => [`- ${l}`, ``]),
    perksLine,
    ``,
    replyCta,
    ``,
    closingLine,
    ``,
    `Cheers,`,
    `${args.shop.name}`,
  ].join("\n");

  const htmlBody = `
<div dir="ltr">
  <p>Hi ${escapeHtml(firstName)},</p>
  <p>${escapeHtml(opener)}</p>
  <p>Here's what the regular rates look like:</p>
  ${rateLines.map((l) => `<p>- ${escapeHtml(l)}</p>`).join("\n  ")}
  <p>${escapeHtml(perksLine)}</p>
  <p>${escapeHtml(replyCta)}</p>
  <p>${escapeHtml(closingLine)}</p>
  <p>Cheers,<br/>${escapeHtml(args.shop.name)}</p>
</div>
`.trim();

  const fromLine = getShopContacts(args.shop).from_line;
  try {
    const response = await sendViaGmailSmtp({
      From: fromLine,
      To: args.contact.email,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
      Metadata: {
        booking_id: args.bookingId,
        shop_id: args.shop.id,
        template_key: args.touchpointKey,
      },
    });
    console.info("Post-detail offer email sent", {
      bookingId: args.bookingId,
      touchpointKey: args.touchpointKey,
      providerMessageId: response.MessageID,
    });
    return { skipped: false as const, providerMessageId: response.MessageID };
  } catch (err) {
    // Fall back to Postmark if Gmail SMTP fails — same belt+braces pattern
    // as elsewhere in the codebase. (Not strictly required, but lets a
    // touchpoint still go out if SMTP creds rotate without redeploy.)
    console.warn("Post-detail offer email via SMTP failed, trying Postmark fallback", {
      bookingId: args.bookingId,
      err,
    });
    try {
      const pm = await getPostmarkClient().sendEmail({
        From: fromLine,
        To: args.contact.email,
        Subject: subject,
        TextBody: textBody,
        HtmlBody: htmlBody,
        MessageStream: "booking-emails",
        TrackOpens: false,
        TrackLinks: "None" as never,
        Metadata: {
          booking_id: args.bookingId,
          shop_id: args.shop.id,
          template_key: args.touchpointKey,
        },
      });
      return { skipped: false as const, providerMessageId: pm.MessageID };
    } catch (pmErr) {
      console.error("Post-detail offer email failed via both transports", { bookingId: args.bookingId, pmErr });
      throw pmErr;
    }
  }
}

/**
 * SMS body builder. Returns the rendered text (no provider call).
 */
export function renderPostDetailOfferSms(args: {
  firstName: string;
  url: string;
  touchpointKey: TouchpointKey;
}): string {
  const fn = args.firstName;
  const url = args.url;
  switch (args.touchpointKey) {
    case "post_detail_recurring_offer_next_day":
      return `Hey ${fn}, hope you're loving how the car came out! Want to keep it looking sharp? Lock in a regular detail and save 35% every visit: ${url} - Clean Car Collective`;
    case "post_detail_recurring_offer_6w":
      return `Hey ${fn}, been about 6 weeks since we sorted your car. Keen to lock in a regular detail and save 35% every visit? Have a look: ${url}`;
    case "post_detail_recurring_offer_10w":
      return `Hey ${fn}, heading into the 3-month mark since your last detail. Sort a 3-monthly rate now and save 20% every visit - after this the discount drops: ${url}`;
    case "post_detail_recurring_offer_16w":
      return `Hey ${fn}, been 4 months since your detail - past this and the car usually needs a proper deep clean. Last chance to lock in a 6-monthly rate at 10% off: ${url}`;
  }
}

export function buildPostDetailOfferLockInUrl(opts: {
  bookingId: string;
  shopId: string;
  featuredCadenceMonths: Cadence;
}): string {
  const token = signActionToken(
    {
      a: "lock_in_recurring",
      r: opts.bookingId,
      s: opts.shopId,
    },
    30 * 24 * 60 * 60
  );
  const url = new URL(`${CRM_BASE_URL}/lock-in-recurring`);
  url.searchParams.set("token", token);
  url.searchParams.set("cadence", String(opts.featuredCadenceMonths));
  return url.toString();
}
