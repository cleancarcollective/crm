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
      return `${firstName} - detailing credit that builds while you're busy`;
    case "post_detail_recurring_offer_16w":
      return `${firstName} - last nudge before the car needs a proper deep clean`;
  }
}

function openerFor(key: TouchpointKey, _shopName: string): string {
  switch (key) {
    case "post_detail_recurring_offer_next_day":
      return `Hope you're loving how the car came out yesterday. If you'd like to keep that just-detailed feel going, we run a membership called the Collective - detailing credit that lands in your account every month and builds until you're ready to use it.`;
    case "post_detail_recurring_offer_6w":
      return `It's been about 6 weeks since we sorted your car - usually the point where most cars start looking a bit tired again. The easiest fix is our Collective membership: detailing credit lands in your account every month, and you book whenever suits.`;
    case "post_detail_recurring_offer_10w":
      return `Quick one - you're coming up on 3 months since we last sorted your car. A lot of our regulars have switched to the Collective: credit lands monthly, and if life gets busy it just stacks - a couple of quiet months turns into a bigger detail when you're ready.`;
    case "post_detail_recurring_offer_16w":
      return `It's been about 4 months since we detailed your car - past this point most cars need a proper deep clean rather than a quick refresh. This is the last nudge from us. If you'd like to stay ahead of it without thinking about dates, the Collective handles it.`;
  }
}

// Collective membership ladder (ex-GST) - mirrors lib/portal/membership.ts.
const COLLECTIVE_LADDER = "from $108/mo (+GST) - most cars are $112/mo for $130 of monthly credit";

export async function sendPostDetailOfferEmail(args: TouchpointEmailArgs) {
  const firstName = args.contact.firstName ?? "there";
  const subject = subjectFor(args.touchpointKey, firstName);
  const opener = openerFor(args.touchpointKey, args.shop.name);

  // Deliberately plain, personal-note style: default font, minimal links.
  // The original HTML template pattern-matched straight into Gmail's
  // Promotions tab (audited 2 Jul 2026) and Promotions placement is as
  // good as unseen. Reply remains the primary CTA; the single account
  // link is the self-serve path.
  const howItWorks = [
    `Here's how the Collective works:`,
    ``,
    `- Detailing credit lands in your account every month (15% more credit than you pay - ${COLLECTIVE_LADDER})`,
    ``,
    `- Get busy? It stacks. Credit never expires - bank a quiet month and put it toward a bigger service next time`,
    ``,
    `- Free mobile service + valet pickup, priority booking, and photos of every detail in your account`,
  ];
  const replyCta = `Keen? Just reply to this email and we'll set it up, or join in two minutes at ${CRM_BASE_URL}/account`;
  const closingLine = `No lock-in - cancel anytime and banked credit stays yours.`;

  const textBody = [
    `Hi ${firstName},`,
    ``,
    opener,
    ``,
    ...howItWorks,
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
  ${howItWorks.filter((l) => l !== "").map((l) => `<p>${escapeHtml(l)}</p>`).join("\n  ")}
  <p>Keen? Just reply to this email and we'll set it up, or <a href="${CRM_BASE_URL}/account">join in two minutes here</a>.</p>
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
      return `Hey ${fn}, hope you're loving how the car came out! Keep it that way with the Collective - detailing credit that builds every month (15% bonus, never expires): ${url} - Clean Car Collective`;
    case "post_detail_recurring_offer_6w":
      return `Hey ${fn}, been about 6 weeks since we sorted your car. Join the Collective and monthly credit does the remembering - it stacks if you get busy: ${url}`;
    case "post_detail_recurring_offer_10w":
      return `Hey ${fn}, coming up on 3 months since your last detail. Collective members bank credit monthly + get priority booking - join in 2 min: ${url}`;
    case "post_detail_recurring_offer_16w":
      return `Hey ${fn}, been 4 months since your detail - past this the car usually needs a proper deep clean. Stay ahead of it with monthly credit that never expires: ${url}`;
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
  // Legacy: the tokened lock-in page still works, but the Collective
  // lives in the account portal - point new sends there.
  void token;
  const url = new URL(`${CRM_BASE_URL}/account`);
  return url.toString();
}
