import { formatInTimeZone } from "date-fns-tz";

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * The website booking form copies a structured dump of every booking field
 * into `notes` ("SERVICES: ...\nADD-ONS: ...\nVEHICLE: ...\nDATE: ...\nNOTES: ...").
 *
 * That dump is fine for the team (cross-check with the live record) but
 * looks bizarre in the customer-facing email — they already see all those
 * fields rendered in the Description table.
 *
 * Heuristic detection: if notes contain ALL_CAPS_LABEL: pattern with multiple
 * known booking fields (SERVICES, ADD-ONS, DELIVERY ADDRESS, etc.), it's
 * the auto-dump. Strip it for customers, keep it for team emails.
 *
 * If the dump contains a real "NOTES:" tail with meaningful customer text,
 * extract just that for customer display.
 */
function cleanNotesForRecipient(
  rawNotes: string | null | undefined,
  isTeamEmail: boolean
): string {
  if (!rawNotes) return "No additional notes.";
  const text = rawNotes.trim();
  if (!text) return "No additional notes.";

  // Team gets the raw dump (helpful for cross-checking)
  if (isTeamEmail) return text;

  // Detect the auto-generated dump pattern
  const looksLikeDump =
    /\b(SERVICES|SERVICE|ADD[-\s]?ONS|DELIVERY\s+ADDRESS|SERVICE\s+ADDRESS)\s*:/i.test(
      text
    ) && /\n\s*[A-Z][A-Z\s\-]+\s*:/.test(text); // multiple ALL_CAPS: lines

  if (!looksLikeDump) return text;

  // Try to extract just the NOTES section
  const notesMatch = text.match(/\bNOTES\s*:\s*([\s\S]+?)$/i);
  if (notesMatch) {
    const notes = notesMatch[1].trim();
    if (
      !notes ||
      /^(no\s+(additional|extra)?\s*(information|notes|info)\.?|n\/?a|none|—|-)$/i.test(notes)
    ) {
      return "No additional notes.";
    }
    return notes;
  }

  // Couldn't extract — discard the dump
  return "No additional notes.";
}

import { getBookingAddOnsLabel } from "@/lib/bookings/addOns";
import { getBookingDisplayName, getVehicleLabel } from "@/lib/dashboard/bookings";
import { formatCurrency } from "@/lib/dashboard/format";
import type { BookingWithRelations, ShopRecord } from "@/lib/dashboard/types";
import { signActionToken } from "@/lib/auth/signedTokens";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { sendViaGmailSmtp } from "@/lib/email/smtpClient";
import { getShopContacts } from "@/lib/email/shopContacts";
import { renderTemplate } from "@/lib/email/templateRenderer";
import type { BookingConfirmationEmailContext, EmailTemplateKey, EmailTemplateRecord } from "@/lib/email/types";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const SHOP_DETAILS: Record<string, { address: string; mapLink: string; phone: string; email: string; website: string }> = {
  christchurch: {
    address: "20 Southwark Street, Christchurch, Central City, 8011",
    mapLink: "https://maps.app.goo.gl/jAb6JhCgXV8Nafc49",
    phone: "0221537335",
    email: "info@cleancarcollective.co.nz",
    website: "https://cleancarcollective.co.nz/christchurch",
  },
  wellington: {
    address: "8 Ebor Street, Te Aro, Wellington 6011",
    mapLink: "https://maps.app.goo.gl/7SKjCH5gcAffkfEi7",
    phone: "0800 476 667",
    email: "hello@cleancarcollective.co.nz",
    website: "https://cleancarcollective.co.nz",
  }
};

const DEFAULT_SHOP_DETAILS = {
  address: "New Zealand",
  mapLink: "https://cleancarcollective.co.nz",
  phone: "0221537335",
  email: "info@cleancarcollective.co.nz",
  website: "https://cleancarcollective.co.nz/christchurch",
};

type SendBookingEmailArgs = {
  shop: ShopRecord;
  booking: BookingWithRelations;
  templateKey: EmailTemplateKey;
  recipient: string | null;
  introLine: string;
  actionLine: string;
  firstName?: string | null;
  fullNameOverride?: string | null;
  includeCustomerDetails?: boolean;
  updateSummary?: string;
};

export async function sendBookingEmail({
  shop,
  booking,
  templateKey,
  recipient,
  introLine,
  actionLine,
  firstName,
  fullNameOverride,
  includeCustomerDetails = false,
  updateSummary
}: SendBookingEmailArgs) {
  if (!recipient) {
    console.info("Booking email skipped: missing recipient email", {
      bookingId: booking.id,
      templateKey
    });
    return { skipped: true as const, reason: "missing_recipient" };
  }

  const template = await getEmailTemplate(shop.id, templateKey);

  if (!template || !template.is_active) {
    console.info("Booking email skipped: missing or inactive template", {
      bookingId: booking.id,
      shopId: shop.id,
      templateKey
    });
    return { skipped: true as const, reason: "missing_template" };
  }

  const alreadySent = await hasExistingEmailForBooking({
    bookingId: booking.id,
    templateId: template.id,
    recipient
  });

  if (alreadySent) {
    console.info("Booking email skipped: already queued or sent", {
      bookingId: booking.id,
      templateKey,
      recipient
    });
    return { skipped: true as const, reason: "already_sent" };
  }

  const rendered = renderTemplate(template, buildTemplateContext({
    shop,
    booking,
    introLine,
    actionLine,
    firstName,
    fullNameOverride,
    includeCustomerDetails,
    updateSummary
  }));

  const messageRecord = await createQueuedEmailMessage({
    shopId: shop.id,
    contactId: booking.contact_id,
    bookingId: booking.id,
    templateId: template.id,
    subject: rendered.subject,
    body: rendered.htmlBody
  });

  console.info("Booking email queued", {
    bookingId: booking.id,
    emailMessageId: messageRecord.id,
    recipient,
    templateKey
  });

  try {
    // Route customer-facing templates via Gmail SMTP (Primary tab); keep
    // the booking-team-notification on Postmark since it's internal and
    // benefits from event tracking.
    const isInternal = templateKey === "booking-team-notification";
    const fromLine = getShopContacts(shop).from_line;
    const response = isInternal
      ? await getPostmarkClient().sendEmail({
          From: fromLine,
          To: recipient,
          Subject: rendered.subject,
          TextBody: rendered.textBody,
          HtmlBody: rendered.htmlBody,
          MessageStream: "booking-emails",
          TrackOpens: false,
          TrackLinks: "None" as never,
          Metadata: {
            email_message_id: messageRecord.id,
            booking_id: booking.id,
            shop_id: shop.id,
            template_key: templateKey,
          },
        })
      : await sendViaGmailSmtp({
          From: fromLine,
          To: recipient,
          Subject: rendered.subject,
          TextBody: rendered.textBody,
          HtmlBody: rendered.htmlBody,
          Metadata: {
            email_message_id: messageRecord.id,
            booking_id: booking.id,
            shop_id: shop.id,
            template_key: templateKey,
          },
        });

    await updateEmailMessageSent({
      id: messageRecord.id,
      providerMessageId: response.MessageID
    });

    console.info("Booking email sent", {
      bookingId: booking.id,
      emailMessageId: messageRecord.id,
      providerMessageId: response.MessageID,
      templateKey
    });

    return { skipped: false as const, emailMessageId: messageRecord.id, providerMessageId: response.MessageID };
  } catch (error) {
    await updateEmailMessageFailed({ id: messageRecord.id });

    console.error("Booking email send failed", {
      bookingId: booking.id,
      emailMessageId: messageRecord.id,
      templateKey,
      error
    });

    throw error;
  }
}

function buildTemplateContext({
  shop,
  booking,
  introLine,
  actionLine,
  firstName,
  fullNameOverride,
  includeCustomerDetails = false,
  updateSummary
}: {
  shop: ShopRecord;
  booking: BookingWithRelations;
  introLine: string;
  actionLine: string;
  firstName?: string | null;
  fullNameOverride?: string | null;
  includeCustomerDetails?: boolean;
  updateSummary?: string;
}): BookingConfirmationEmailContext {
  const shopDetails = SHOP_DETAILS[shop.slug] ?? DEFAULT_SHOP_DETAILS;
  const isMobile = (booking.location_type ?? "").toLowerCase().includes("mobile");

  // Map raw enum to a customer-facing string. Templates just see one
  // friendly phrase regardless of how `location_type` is stored.
  function humaniseLocation(raw: string | null | undefined): string {
    const v = (raw ?? "").toLowerCase().trim();
    if (!v) return "To be confirmed";
    if (v.includes("mobile")) return "We come to you";
    if (v === "in_shop" || v === "shop" || v.includes("drop")) return "Drop-off at our shop";
    return raw as string; // unknown — surface as-is so we notice
  }

  // Customer self-service link — only on customer-facing emails (skip team).
  // 14-day expiry covers most reschedule windows; customer can always reply
  // to the email if their token expires.
  let manageBookingUrl: string | undefined;
  if (!includeCustomerDetails) {
    try {
      if (process.env.ACTION_TOKEN_SECRET) {
        const token = signActionToken(
          { a: "manage_booking", r: booking.id, s: shop.id },
          14 * 24 * 60 * 60
        );
        const base = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";
        manageBookingUrl = `${base}/manage-booking?token=${encodeURIComponent(token)}`;
      }
    } catch (err) {
      console.warn("manage_booking token mint failed; omitting self-service link", err);
    }
  }

  // Deep link to the booking in the CRM — only emitted for team-facing
  // emails so staff can jump straight to the record. Customer emails get
  // the manage_booking_url instead.
  const crmBookingUrl = includeCustomerDetails
    ? `${process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz"}/bookings/${booking.id}`
    : undefined;

  // Split promo/discount note from customer notes. The intake route
  // prepends a promo note (if any) to booking.notes joined by "\n\n".
  // Render the promo as its own styled block so the "Notes" section
  // shows only the customer's own text.
  const rawNotesSource = booking.notes || booking.service_details || "";
  let promoNote: string | undefined;
  let remainingNotes = rawNotesSource;
  const promoMatch = rawNotesSource.match(/^(Promo code [^\n]+(?:\n[^\n]+)*?)(?:\n{2,}|\n*$)/);
  if (promoMatch) {
    promoNote = promoMatch[1];
    remainingNotes = rawNotesSource.slice(promoMatch[0].length);
  }

  return {
    first_name: capitalise(firstName ?? booking.contact?.first_name ?? "there"),
    full_name: fullNameOverride ?? getBookingDisplayName(booking),
    service_name: booking.service_name,
    add_ons: getBookingAddOnsLabel(booking.raw_payload),
    update_summary: updateSummary,
    scheduled_date: formatInTimeZone(booking.scheduled_start, shop.timezone, "EEEE d MMMM yyyy"),
    scheduled_time: formatInTimeZone(booking.scheduled_start, shop.timezone, "h:mm a"),
    vehicle_label: getVehicleLabel(booking),
    location_type: humaniseLocation(booking.location_type),
    price_estimate: formatCurrency(booking.price_estimate),
    notes: cleanNotesForRecipient(
      remainingNotes,
      includeCustomerDetails ?? false
    ),
    promo_note: promoNote,
    crm_booking_url: crmBookingUrl,
    intro_line: introLine,
    action_line: actionLine,
    shop_name: shop.name,
    shop_address: isMobile ? "Mobile — our team will come to you" : shopDetails.address,
    shop_map_link: isMobile ? "" : shopDetails.mapLink,
    shop_phone: shopDetails.phone,
    shop_email: shopDetails.email,
    shop_website: shopDetails.website,
    manage_booking_url: manageBookingUrl,
    ...(includeCustomerDetails && {
      customer_name: getBookingDisplayName(booking),
      customer_email: booking.contact?.email ?? undefined,
      customer_phone: booking.contact?.phone ?? undefined,
    })
  };
}

async function getEmailTemplate(shopId: string, key: EmailTemplateKey) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("email_templates")
    .select("*")
    .eq("shop_id", shopId)
    .eq("key", key)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as EmailTemplateRecord | null;
}

async function hasExistingEmailForBooking({
  bookingId,
  templateId,
  recipient
}: {
  bookingId: string;
  templateId: string;
  recipient: string;
}) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("email_messages")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("template_id", templateId)
    .or("status.eq.queued,status.eq.sent")
    .limit(1);

  if (error) {
    throw error;
  }

  return (data ?? []).length > 0;
}

async function createQueuedEmailMessage({
  shopId,
  contactId,
  bookingId,
  templateId,
  subject,
  body
}: {
  shopId: string;
  contactId: string | null;
  bookingId: string;
  templateId: string;
  subject: string;
  body: string;
}) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("email_messages")
    .insert({
      shop_id: shopId,
      contact_id: contactId,
      booking_id: bookingId,
      template_id: templateId,
      subject,
      body_rendered: body,
      status: "queued"
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as { id: string };
}

async function updateEmailMessageSent({
  id,
  providerMessageId
}: {
  id: string;
  providerMessageId: string;
}) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("email_messages")
    .update({
      provider_message_id: providerMessageId,
      status: "sent",
      sent_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) {
    throw error;
  }
}

async function updateEmailMessageFailed({ id }: { id: string }) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("email_messages")
    .update({
      status: "failed"
    })
    .eq("id", id);

  if (error) {
    throw error;
  }
}
