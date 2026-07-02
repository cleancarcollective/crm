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

type Cadence = 2 | 3 | 4;

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
      return `Heads up ${firstName} - the 10% rate is about to disappear`;
    case "post_detail_recurring_offer_16w":
      return `${firstName} - last call before the car needs a proper deep clean`;
  }
}

function openerFor(key: TouchpointKey, _shopName: string): string {
  switch (key) {
    case "post_detail_recurring_offer_next_day":
      return `Hope you're loving how the car came out yesterday. If you'd like to keep that just-detailed feel going, we offer a regular detail rate that saves you up to 15% on every visit. No contracts - cancel or pause whenever.`;
    case "post_detail_recurring_offer_6w":
      return `It's been about 6 weeks since we sorted your car - usually the point where most cars start looking a bit tired again. If you'd like to stay on top of it, lock in a fortnightly rate and we'll knock 15% off every visit. No commitment, cancel or pause whenever you like.`;
    case "post_detail_recurring_offer_10w":
      return `Quick one - you're heading into the 3-month window since we last sorted your car. If you want to keep things tidy, lock in a 3-monthly rate now and save 10% every visit. Heads up though: after this the 10% rate is gone and you'll be looking at the 5% tier from here on.`;
    case "post_detail_recurring_offer_16w":
      return `It's been about 4 months since we detailed your car - past this point most cars need a proper deep clean rather than a quick refresh. This is the last nudge from us. If you'd like to keep things on a schedule and avoid the big resets, lock in a 4-monthly rate and save 5% every visit.`;
  }
}

const ALL_CADENCES: Array<{ months: Cadence; label: string; discount: number }> = [
  { months: 2, label: "Every 2 months", discount: 15 },
  { months: 3, label: "Every 3 months", discount: 10 },
  { months: 4, label: "Every 4 months", discount: 5 },
];

function priceLine(basePrice: number | null, discount: number): string | null {
  if (basePrice == null) return null;
  const discounted = basePrice * (1 - discount / 100);
  return `${formatCurrency(discounted)} per visit (${discount}% off ${formatCurrency(basePrice)})`;
}

function buildLockInUrl(args: TouchpointEmailArgs): string {
  const token = signActionToken(
    {
      a: "lock_in_recurring",
      r: args.bookingId,
      s: args.shop.id,
    },
    30 * 24 * 60 * 60
  );
  // Featured cadence is sent as a query param so the lock-in page can
  // pre-select it without unpacking the token client-side.
  const url = new URL(`${CRM_BASE_URL}/lock-in-recurring`);
  url.searchParams.set("token", token);
  url.searchParams.set("cadence", String(args.featuredCadenceMonths));
  return url.toString();
}

export async function sendPostDetailOfferEmail(args: TouchpointEmailArgs) {
  const firstName = args.contact.firstName ?? "there";
  const subject = subjectFor(args.touchpointKey, firstName);
  const lockInUrl = buildLockInUrl(args);
  const opener = openerFor(args.touchpointKey, args.shop.name);

  const cadenceRows = ALL_CADENCES.map((c) => {
    const line = priceLine(args.basePrice, c.discount);
    const isFeatured = c.months === args.featuredCadenceMonths;
    return { ...c, priceText: line, isFeatured };
  });

  // Deliberately plain, personal-note style. The original branded HTML shell
  // (dark header, pricing table, CTA button, discount badges) pattern-matched
  // straight into Gmail's Promotions tab — audited 2 Jul 2026, and Promotions
  // placement is as good as unseen. A short note that looks hand-written from
  // a real mailbox lands in Primary. Same offer, same signed link.
  const featured = cadenceRows.find((c) => c.isFeatured) ?? cadenceRows[0]!;
  const others = cadenceRows.filter((c) => c !== featured);

  const featuredSentence = featured.priceText
    ? `Most people go ${featured.label.toLowerCase()} - that works out to ${featured.priceText}.`
    : `Most people go ${featured.label.toLowerCase()} - that saves you ${featured.discount}% on every visit.`;
  const othersSentence = others.length
    ? `We also do ${others.map((c) => `${c.label.toLowerCase()} (${c.discount}% off)`).join(" or ")} if that suits better.`
    : "";

  const optOutLine = `No contracts - pause or cancel whenever you like. And if you'd rather not get these emails, just reply and let me know.`;

  const textBody = [
    `Hi ${firstName},`,
    ``,
    opener,
    ``,
    featuredSentence,
    othersSentence,
    ``,
    `You can lock it in here: ${lockInUrl}`,
    ``,
    optOutLine,
    ``,
    `Cheers,`,
    `${args.shop.name}`,
  ].filter((l) => l !== "").join("\n\n").replace(/\n\n\n+/g, "\n\n");

  const htmlBody = `
<div dir="ltr">
  <p>Hi ${escapeHtml(firstName)},</p>
  <p>${escapeHtml(opener)}</p>
  <p>${escapeHtml(featuredSentence)}${othersSentence ? ` ${escapeHtml(othersSentence)}` : ""}</p>
  <p>You can <a href="${escapeHtml(lockInUrl)}">lock it in here</a> - takes about a minute.</p>
  <p>${escapeHtml(optOutLine)}</p>
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
      return `Hey ${fn}, hope you're loving how the car came out! Want to keep it looking sharp? Lock in a regular detail and save 15% every visit: ${url} - Clean Car Collective`;
    case "post_detail_recurring_offer_6w":
      return `Hey ${fn}, been about 6 weeks since we sorted your car. Keen to lock in a regular detail and save 15% every visit? Have a look: ${url}`;
    case "post_detail_recurring_offer_10w":
      return `Hey ${fn}, heading into the 3-month mark since your last detail. Sort a 3-monthly rate now and save 10% every visit - after this the discount drops: ${url}`;
    case "post_detail_recurring_offer_16w":
      return `Hey ${fn}, been 4 months since your detail - past this and the car usually needs a proper deep clean. Last chance to lock in a 4-monthly rate at 5% off: ${url}`;
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
