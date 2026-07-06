/**
 * Ad-lead nurture drip — 3 emails + 1 SMS over 6 days for leads that came
 * from a paid-ad landing page (resolveLandingPromo matched, e.g.
 * /10-off-road-trip/) and received an instant quote but haven't booked.
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
 *   - hard cap: 3 emails + 1 SMS, then the sequence is over
 *
 * Copy approved by the owner 2026-07-06 — kiwi tone, no em dashes, no hard
 * sell. Plain-note style so it lands in Gmail Primary; emails 1-2 carry no
 * link (reply CTA), email 3 carries one bare booking link.
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

export const AD_NURTURE_SMS_TEMPLATE_KEY = "ad_nurture_sms_day4";

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
  /** Customer phone for the day-4 SMS touch; null skips the SMS. */
  phone?: string | null;
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
 * Schedule the nurture touches for a fresh ad lead: emails at +22h, +3d,
 * +6d and an SMS at +4d (when a phone exists). Called from the instant
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

  if (payload.phone) {
    try {
      await scheduleAdNurtureSms(payload, new Date(now + 4 * DAY).toISOString());
    } catch (e) {
      console.error("Ad-nurture SMS scheduling failed (non-fatal)", { leadId: payload.leadId, e });
    }
  }
}

/**
 * Day-4 SMS. Message is pre-rendered at schedule time (nothing in it is
 * time-sensitive); the SMS processor's lead-context guard re-checks
 * lead.status='sent' + recent bookings at send time, same as the emails.
 */
export async function scheduleAdNurtureSms(payload: AdNurturePayload, scheduledFor: string) {
  if (!payload.phone) return;
  const { getShopContactsById } = await import("@/lib/email/shopContacts");
  const contacts = await getShopContactsById(payload.shopId);
  const veh = payload.vehicleLabel || "car";

  const message =
    `Hi ${payload.firstName || "there"}, ${contacts.sender_name} from Clean Car Collective here! ` +
    `Just reaching out as I saw you were interested in getting your ${veh} detailed, but haven't booked in yet. ` +
    `I wanted to check and see if there was any other info you needed, as your 10% off code only has a couple of days left. ` +
    `If you'd like to lock in a time to secure one of our remaining slots, let me know!`;

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("scheduled_sms_jobs").insert({
    shop_id: payload.shopId,
    lead_id: payload.leadId,
    booking_id: null,
    contact_id: payload.contactId,
    phone: payload.phone,
    message,
    template_key: AD_NURTURE_SMS_TEMPLATE_KEY,
    scheduled_for: scheduledFor,
    status: "pending",
  });
  if (error) {
    // Unique (shop_id, lead_id, template_key) makes re-schedules a no-op.
    if (!/duplicate|unique/i.test(error.message)) throw error;
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────
// Owner-approved copy. Plain-note style: default font, no images, prices in
// sentences. Emails 1-2 have no link (reply CTA); email 3 has one bare link.

/** Outcome-led package descriptions, keyed by quoted package name. */
const PACKAGE_DESCRIPTIONS: Record<string, string> = {
  "Deluxe Detail":
    "Built for daily drivers, we start with a full exterior hand wash (the Clean Car Collective way), wheels and door jambs detailed properly, interior vacuumed with every single plastic surface detailed and protected, then a 3-month paint sealant over the top. The car feels brand new, inside and out in around 4 hours.",
  "Premium Detail":
    "For cars that need a deep reset. Everything in the Deluxe, plus a full shampoo of seats, carpets, and floor mats, a clay bar decontamination so the paint feels glass smooth, engine bay cleaned and dressed, and a 6-month ceramic paint sealant. This package is for cars that need some extra love to get them back to a showroom shine. It's our most popular for busy families or professionals who just want a detail done right!",
  "Deluxe Interior":
    "Built for daily drivers, a full interior vacuum, every plastic surface detailed and protected, crevices done properly, plus door jambs and interior windows. The inside feels fresh again in a few hours.",
  "Premium Interior":
    "For interiors that need a deep reset. Everything in the Deluxe Interior, plus a full shampoo and extraction of seats, carpets, and floor mats, stain extraction, and interior deodorising. Built for cars that have lived a life, kids, pets, the lot!",
  "Deluxe Exterior":
    "A proper exterior refresh. Full hand wash (the Clean Car Collective way), wheels, barrels, and tyres detailed, windows and mirrors done, finished with a 3-month wax/sealant to keep it easy to wash.",
  "Premium Exterior":
    "For paint that needs extra care. Everything in the Deluxe Exterior, plus a clay bar treatment and full paint decontamination, so the paint feels glass smooth and comes up to a proper shine.",
};

function daysLeft(payload: AdNurturePayload, atTouch: number): number {
  // Code is "valid 7 days from quote"; touch N lands ~N days in.
  const quoted = Date.parse(payload.quotedAt) || Date.now();
  const elapsed = Math.floor((Date.now() - quoted) / (24 * 60 * 60 * 1000));
  return Math.max(1, 7 - Math.max(elapsed, atTouch));
}

function priceSuffix(p: AdNurturePackage): string {
  const orig = p.originalPriceLabel
    ? ` (usually ${p.originalPriceLabel.replace(" + GST", "")})`
    : "";
  return `${p.priceLabel.replace(" + GST", "")} + GST with your code${orig}`;
}

/** Text + HTML block for one quoted package: name, price, outcome copy. */
function packageBlock(p: AdNurturePackage): { text: string; html: string } {
  const desc = PACKAGE_DESCRIPTIONS[p.name] ?? "";
  const priceLine = `The ${p.name} - ${priceSuffix(p)}.`;
  return {
    text: `${priceLine}\n\n${desc}`.trim(),
    html: `<p><strong>The ${p.name} - ${priceSuffix(p)}.</strong></p>${desc ? `<p>${desc}</p>` : ""}`,
  };
}

export function renderAdNurtureEmail(
  jobType: AdNurtureJobType,
  payload: AdNurturePayload,
  shopSlug: string,
  senderFirstName: string
): { subject: string; textBody: string; htmlBody: string } {
  const link = bookingLink(shopSlug, payload);
  const veh = payload.vehicleLabel || "car";
  const first = payload.firstName || "there";
  const code = payload.promoCode;
  const pct = payload.promoPercentOff;
  const hasPackages = payload.packages.length > 0;

  if (jobType === "ad_nurture_day1") {
    const left = daysLeft(payload, 1);
    const subject = `${first}, let's get your ${veh} looking brand new!`;

    const packagesIntro = "We offer a wide range of packages, but our two most popular are;";
    const blocks = payload.packages.map(packageBlock);
    const packagesText = hasPackages
      ? `${packagesIntro}\n\n${blocks.map((b) => b.text).join("\n\n")}`
      : `Your full quote and prices are in the estimate email we sent you.`;
    const packagesHtml = hasPackages
      ? `<p>${packagesIntro}</p>${blocks.map((b) => b.html).join("")}`
      : `<p>Your full quote and prices are in the estimate email we sent you.</p>`;

    const textBody = `Hi ${first},

Thanks for reaching out for a quote to get your ${veh} detailed! I wanted to personally reach out and check if you needed any further information or wanted to explore our various options.

Your quote is still valid, and we're offering you ${pct}% off with code ${code} for another ${left} days.

${packagesText}

If you'd like to secure a booking while the code is active, just reply with a day that suits, and I'll set it up for you. Nothing to pay until the detail is done and we've confirmed you're happy with the results.

Thanks,
${senderFirstName}`;

    const htmlBody = `<div style="font-family:inherit;font-size:14px;line-height:1.6;color:#222;">
<p>Hi ${first},</p>
<p>Thanks for reaching out for a quote to get your ${veh} detailed! I wanted to personally reach out and check if you needed any further information or wanted to explore our various options.</p>
<p>Your quote is still valid, and we're offering you ${pct}% off with code <strong>${code}</strong> for another <strong>${left} days</strong>.</p>
${packagesHtml}
<p>If you'd like to secure a booking while the code is active, just reply with a day that suits, and I'll set it up for you. Nothing to pay until the detail is done and we've confirmed you're happy with the results.</p>
<p>Thanks,<br>${senderFirstName}</p>
</div>`;
    return { subject, textBody, htmlBody };
  }

  if (jobType === "ad_nurture_day3") {
    const subject = `Any questions about detailing your ${veh}?`;
    const textBody = `Hi ${first},

${senderFirstName} here again, just floating this back to the top of your inbox in case it got buried. Happy to answer anything about getting the ${veh} detailed if you're still weighing it up.

The questions we get most often:

"Will it actually come up looking brand new?" That's the whole job. We're rated 5.0 from 230+ Google reviews, and every detail is backed by our money back guarantee. If you're not happy with the result, you don't pay.

"My car's got dog hair / kid mess / stains / swirl marks." Tell us what you're dealing with and we'll tell you honestly what result to expect. Every package gets tailored to the car in front of us.

"I'm too busy for this." We make the detail about you. No queues, no waiting. Your car is our only focus on the day, so we don't leave you stranded without it.

Your ${pct}% off code (${code}) still has a few days left. Reply any time with a question or a day that suits, and we'll sort the rest.

Thanks,
${senderFirstName}`;

    const htmlBody = `<div style="font-family:inherit;font-size:14px;line-height:1.6;color:#222;">
<p>Hi ${first},</p>
<p>${senderFirstName} here again, just floating this back to the top of your inbox in case it got buried. Happy to answer anything about getting the ${veh} detailed if you're still weighing it up.</p>
<p>The questions we get most often:</p>
<p><strong>"Will it actually come up looking brand new?"</strong> That's the whole job. We're rated 5.0 from 230+ Google reviews, and every detail is backed by our money back guarantee. If you're not happy with the result, you don't pay.</p>
<p><strong>"My car's got dog hair / kid mess / stains / swirl marks."</strong> Tell us what you're dealing with and we'll tell you honestly what result to expect. Every package gets tailored to the car in front of us.</p>
<p><strong>"I'm too busy for this."</strong> We make the detail about you. No queues, no waiting. Your car is our only focus on the day, so we don't leave you stranded without it.</p>
<p>Your ${pct}% off code (<strong>${code}</strong>) still has a few days left. Reply any time with a question or a day that suits, and we'll sort the rest.</p>
<p>Thanks,<br>${senderFirstName}</p>
</div>`;
    return { subject, textBody, htmlBody };
  }

  // ad_nurture_day6 — last call + package-matched sweeteners.
  const subject = `Last chance to get your ${veh} looking brand new, ${first}`;
  const textBody = `Hi ${first},

Your ${code} code (${pct}% off) wraps up tomorrow, so this is my last note about it.

To sweeten the deal if you book this week:

Book the Deluxe Detail and we'll upgrade your 3-month paint sealant to our 6 Month Ceramic Sealant, no charge. That's a $100 extra on us, and it keeps the paint protected and easy to wash right through winter.

Book the Premium Detail and we'll add a ceramic coating for your windscreen and front windows, normally $150. Better visibility in the rain and the wipers barely have to work.

You can book with the code applied here:
${link}

Or simply reply with a day that suits and I'll lock it in for you. As always, nothing to pay until the detail is done and you're happy with the results.

After tomorrow the quote reverts to full price. Either way, thanks for considering us!

Thanks,
${senderFirstName}`;

  const htmlBody = `<div style="font-family:inherit;font-size:14px;line-height:1.6;color:#222;">
<p>Hi ${first},</p>
<p>Your <strong>${code}</strong> code (${pct}% off) wraps up tomorrow, so this is my last note about it.</p>
<p>To sweeten the deal if you book this week:</p>
<p><strong>Book the Deluxe Detail</strong> and we'll upgrade your 3-month paint sealant to our 6 Month Ceramic Sealant, no charge. That's a $100 extra on us, and it keeps the paint protected and easy to wash right through winter.</p>
<p><strong>Book the Premium Detail</strong> and we'll add a ceramic coating for your windscreen and front windows, normally $150. Better visibility in the rain and the wipers barely have to work.</p>
<p>You can book with the code applied here:<br><a href="${link}"><strong>Book your detail online</strong></a></p>
<p>Or simply reply with a day that suits and I'll lock it in for you. As always, nothing to pay until the detail is done and you're happy with the results.</p>
<p>After tomorrow the quote reverts to full price. Either way, thanks for considering us!</p>
<p>Thanks,<br>${senderFirstName}</p>
</div>`;
  return { subject, textBody, htmlBody };
}
