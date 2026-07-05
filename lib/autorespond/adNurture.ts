/**
 * Ad-lead nurture drip — 3 emails over 6 days for leads that came from a
 * paid-ad landing page (resolveLandingPromo matched, e.g. /10-off-road-trip/)
 * and received an instant quote but haven't booked.
 *
 * Scoped deliberately: the global lead follow-ups (LEAD_FOLLOWUPS_ENABLED)
 * stay off — this sequence only ever targets promo-landing leads, who are
 * cold social traffic that converts on follow-up rather than first visit.
 *
 * Pull-out mechanics (why this doesn't spam):
 *   - send-time guard skips unless lead.status is still 'sent'
 *     (staff changing status / disposition in the CRM stops the sequence)
 *   - skips if the contact's email/phone has any recent booking
 *   - skips if the lead's email hard-bounced or a cooldown is set
 *   - booking intake cancels all pending lead jobs (cancelLeadJobs)
 *   - hard cap: 3 touches, then the sequence is over
 *
 * Kill switch: AD_LEAD_NURTURE_ENABLED=false disables scheduling (default on).
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { scheduleLeadJob } from "@/lib/scheduling/leadJobs";

export type AdNurtureJobType = "ad_nurture_day1" | "ad_nurture_day3" | "ad_nurture_day6";

export const AD_NURTURE_JOB_TYPES: AdNurtureJobType[] = [
  "ad_nurture_day1",
  "ad_nurture_day3",
  "ad_nurture_day6",
];

export type AdNurturePackage = {
  name: string;
  priceLabel: string;
  originalPriceLabel: string | null;
};

export type AdNurturePayload = {
  shopId: string;
  leadId: string;
  contactId: string | null;
  email: string;
  firstName: string;
  vehicleLabel: string;
  promoCode: string;
  promoPercentOff: number;
  packages: AdNurturePackage[];
  bookingVehicleType: string | null;
  /** ISO timestamp of when the quote was shown — drives "X days left" copy. */
  quotedAt: string;
};

// WP pages embedding the booking apps. Links go to the top-level page with
// params; the booking iframe reads them back via document.referrer.
const BOOKING_PAGES: Record<string, string> = {
  wellington: "https://cleancarcollective.co.nz/make-a-booking/",
  christchurch: "https://cleancarcollective.co.nz/christchurch-make-a-booking/",
};

function bookingLink(shopSlug: string, payload: AdNurturePayload): string {
  const base = BOOKING_PAGES[shopSlug] ?? BOOKING_PAGES.christchurch;
  const params = new URLSearchParams();
  params.set("code", payload.promoCode);
  if (payload.bookingVehicleType) params.set("vehicle", payload.bookingVehicleType);
  params.set("src", "nurture");
  return `${base}?${params.toString()}`;
}

/**
 * Schedule the 3-touch nurture for a fresh ad lead. Called from the instant
 * quote path in processLeadAutoRespond. Non-fatal by design — callers wrap
 * in try/catch so a scheduling hiccup never breaks lead intake.
 */
export async function scheduleAdLeadNurture(payload: AdNurturePayload) {
  if (process.env.AD_LEAD_NURTURE_ENABLED === "false") {
    console.info("Ad-lead nurture disabled (AD_LEAD_NURTURE_ENABLED=false) — skipping", {
      leadId: payload.leadId,
    });
    return;
  }

  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  const touches: Array<{ jobType: AdNurtureJobType; at: string }> = [
    { jobType: "ad_nurture_day1", at: new Date(now + 22 * HOUR).toISOString() },
    { jobType: "ad_nurture_day3", at: new Date(now + 3 * DAY).toISOString() },
    { jobType: "ad_nurture_day6", at: new Date(now + 6 * DAY).toISOString() },
  ];

  for (const t of touches) {
    await scheduleLeadJob({
      shopId: payload.shopId,
      leadId: payload.leadId,
      contactId: payload.contactId,
      // Widening cast: leadJobs' LeadJobType doesn't know the nurture types;
      // job_type is a plain text column and process-scheduled dispatches on it.
      jobType: t.jobType as never,
      templateKey: t.jobType,
      scheduledFor: t.at,
      payload: payload as never,
    });
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────
// Hand-written plain-note style, same reasoning as the post-detail drip:
// branded promo shells pattern-match into Gmail's Promotions tab. Default
// font, prices in sentences, one plain link, reply-to-stop line.

function daysLeft(payload: AdNurturePayload, atTouch: number): number {
  // Code is "valid 7 days from quote"; touch N lands ~N days in.
  const quoted = Date.parse(payload.quotedAt) || Date.now();
  const elapsed = Math.floor((Date.now() - quoted) / (24 * 60 * 60 * 1000));
  return Math.max(1, 7 - Math.max(elapsed, atTouch));
}

function packageLines(payload: AdNurturePayload): string {
  return payload.packages
    .map((p) => {
      const was = p.originalPriceLabel ? ` (was ${p.originalPriceLabel.replace(" + GST", "")})` : "";
      return `- ${p.name}: ${p.priceLabel}${was}`;
    })
    .join("\n");
}

function packageLinesHtml(payload: AdNurturePayload): string {
  return payload.packages
    .map((p) => {
      const was = p.originalPriceLabel
        ? ` <span style="color:#888;text-decoration:line-through;">${p.originalPriceLabel.replace(" + GST", "")}</span>`
        : "";
      return `<li>${p.name}: <strong>${p.priceLabel}</strong>${was}</li>`;
    })
    .join("");
}

const STOP_LINE = "If you'd rather not hear from us about this, just reply and say so — that's the last you'll get.";

export function renderAdNurtureEmail(
  jobType: AdNurtureJobType,
  payload: AdNurturePayload,
  shopSlug: string,
  senderFirstName: string
): { subject: string; textBody: string; htmlBody: string } {
  const link = bookingLink(shopSlug, payload);
  const veh = payload.vehicleLabel || "your vehicle";
  const first = payload.firstName || "there";
  const pct = payload.promoPercentOff;
  const code = payload.promoCode;

  const hasPackages = payload.packages.length > 0;

  if (jobType === "ad_nurture_day1") {
    const left = daysLeft(payload, 1);
    const subject = `Your ${pct}% off quote for the ${veh}`;
    const priceBlockText = hasPackages
      ? `Where it stands:
${packageLines(payload)}

Those prices already include the ${pct}% off, and the code applies automatically when you book here:`
      : `The full breakdown is in the estimate email we sent you, and the code applies automatically when you book here:`;
    const textBody = `Hi ${first},

Quick one from us at Clean Car Collective — your quote for the ${veh} is still active, and the ${code} code (${pct}% off) on it is good for another ${left} days.

${priceBlockText}
${link}

Booking takes about a minute and there's nothing to pay until the day.

Any questions, just reply — a real person reads these.

${senderFirstName}
Clean Car Collective

${STOP_LINE}`;
    const htmlBody = `<div style="font-family:inherit;font-size:14px;line-height:1.6;color:#222;">
<p>Hi ${first},</p>
<p>Quick one from us at Clean Car Collective — your quote for the ${veh} is still active, and the <strong>${code}</strong> code (${pct}% off) on it is good for another <strong>${left} days</strong>.</p>
${hasPackages
    ? `<p>Where it stands:</p>
<ul>${packageLinesHtml(payload)}</ul>
<p>Those prices already include the ${pct}% off, and the code applies automatically when you <a href="${link}">book here</a>.</p>`
    : `<p>The full breakdown is in the estimate email we sent you, and the code applies automatically when you <a href="${link}">book here</a>.</p>`}
<p>Booking takes about a minute and there's nothing to pay until the day.</p>
<p>Any questions, just reply — a real person reads these.</p>
<p>${senderFirstName}<br>Clean Car Collective</p>
<p style="color:#888;font-size:12px;">${STOP_LINE}</p>
</div>`;
    return { subject, textBody, htmlBody };
  }

  if (jobType === "ad_nurture_day3") {
    const featured = payload.packages[payload.packages.length - 1] ?? payload.packages[0];
    const featuredLineText = featured
      ? `- Most customers in your spot go for the ${featured.name} — ${featured.priceLabel} with your code applied.\n`
      : "";
    const featuredLineHtml = featured
      ? `<li>Most customers in your spot go for the ${featured.name} — <strong>${featured.priceLabel}</strong> with your code applied.</li>`
      : "";
    const subject = `Still thinking it over? (${veh})`;
    const textBody = `Hi ${first},

No rush — just making sure you still have your ${pct}% off quote for the ${veh} handy:
${link}

A couple of things people usually want to know before they book:

- We're a 5.0-star shop on Google (230+ reviews) and every detail comes with a money-back guarantee.
${featuredLineText}- Every package can be tailored to your car. Mention anything specific when you book and we'll sort it.

Your code has a few days left on it. Reply if you'd like a hand choosing.

${senderFirstName}
Clean Car Collective

${STOP_LINE}`;
    const htmlBody = `<div style="font-family:inherit;font-size:14px;line-height:1.6;color:#222;">
<p>Hi ${first},</p>
<p>No rush — just making sure you still have your ${pct}% off quote for the ${veh} handy: <a href="${link}">book with the code applied</a>.</p>
<p>A couple of things people usually want to know before they book:</p>
<ul>
<li>We're a 5.0-star shop on Google (230+ reviews) and every detail comes with a money-back guarantee.</li>
${featuredLineHtml}
<li>Every package can be tailored to your car. Mention anything specific when you book and we'll sort it.</li>
</ul>
<p>Your code has a few days left on it. Reply if you'd like a hand choosing.</p>
<p>${senderFirstName}<br>Clean Car Collective</p>
<p style="color:#888;font-size:12px;">${STOP_LINE}</p>
</div>`;
    return { subject, textBody, htmlBody };
  }

  // ad_nurture_day6 — last call + sealant upgrade sweetener on full details.
  const subject = `Last day for your ${pct}% off (${veh})`;
  const textBody = `Hi ${first},

Your ${code} code wraps up tomorrow, so this is the last nudge from us.

To make it an easy yes: book a Deluxe or Premium Detail this week and we'll upgrade the standard 3-month sealant to our 6 Month Ceramic Sealant free — that's a $100 extra, on us. Just mention "sealant upgrade" in the booking notes.

Book with your ${pct}% off here:
${link}

After tomorrow the quote reverts to full price. Either way, thanks for considering us.

${senderFirstName}
Clean Car Collective

${STOP_LINE}`;
  const htmlBody = `<div style="font-family:inherit;font-size:14px;line-height:1.6;color:#222;">
<p>Hi ${first},</p>
<p>Your <strong>${code}</strong> code wraps up tomorrow, so this is the last nudge from us.</p>
<p>To make it an easy yes: book a <strong>Deluxe or Premium Detail</strong> this week and we'll upgrade the standard 3-month sealant to our <strong>6 Month Ceramic Sealant free</strong> — that's a $100 extra, on us. Just mention "sealant upgrade" in the booking notes.</p>
<p><a href="${link}">Book with your ${pct}% off here</a>.</p>
<p>After tomorrow the quote reverts to full price. Either way, thanks for considering us.</p>
<p>${senderFirstName}<br>Clean Car Collective</p>
<p style="color:#888;font-size:12px;">${STOP_LINE}</p>
</div>`;
  return { subject, textBody, htmlBody };
}
