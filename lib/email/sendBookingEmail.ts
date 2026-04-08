import { formatInTimeZone } from "date-fns-tz";

import { getBookingAddOnsLabel } from "@/lib/bookings/addOns";
import { getBookingDisplayName, getVehicleLabel } from "@/lib/dashboard/bookings";
import { formatCurrency } from "@/lib/dashboard/format";
import type { BookingWithRelations, ShopRecord } from "@/lib/dashboard/types";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { renderTemplate } from "@/lib/email/templateRenderer";
import type { BookingConfirmationEmailContext, EmailTemplateKey, EmailTemplateRecord } from "@/lib/email/types";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const SHOP_DETAILS: Record<string, { address: string; mapLink: string; phone: string; email: string }> = {
  christchurch: {
    address: "20 Southwark Street, Christchurch, Central City, 8011",
    mapLink: "https://maps.app.goo.gl/jAb6JhCgXV8Nafc49",
    phone: "0221537335",
    email: "info@cleancarcollective.co.nz"
  },
  wellington: {
    address: "8 Ebor Street, Te Aro, Wellington 6011",
    mapLink: "https://maps.app.goo.gl/7SKjCH5gcAffkfEi7",
    phone: "0800 476 667",
    email: "hello@cleancarcollective.co.nz"
  }
};

const DEFAULT_SHOP_DETAILS = {
  address: "New Zealand",
  mapLink: "https://cleancarcollective.co.nz",
  phone: "0800 476 667",
  email: "hello@cleancarcollective.co.nz"
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

function getRequiredEnv(name: "POSTMARK_FROM_EMAIL") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

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
    const postmark = getPostmarkClient();
    const response = await postmark.sendEmail({
      From: getRequiredEnv("POSTMARK_FROM_EMAIL"),
      To: recipient,
      Subject: rendered.subject,
      TextBody: rendered.textBody,
      HtmlBody: rendered.htmlBody,
      MessageStream: "booking-emails",
      Metadata: {
        email_message_id: messageRecord.id,
        booking_id: booking.id,
        shop_id: shop.id,
        template_key: templateKey
      }
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

  return {
    first_name: firstName ?? booking.contact?.first_name ?? "there",
    full_name: fullNameOverride ?? getBookingDisplayName(booking),
    service_name: booking.service_name,
    add_ons: getBookingAddOnsLabel(booking.raw_payload),
    update_summary: updateSummary,
    scheduled_date: formatInTimeZone(booking.scheduled_start, shop.timezone, "EEEE d MMMM yyyy"),
    scheduled_time: formatInTimeZone(booking.scheduled_start, shop.timezone, "h:mm a"),
    vehicle_label: getVehicleLabel(booking),
    location_type: booking.location_type ?? "To be confirmed",
    price_estimate: formatCurrency(booking.price_estimate),
    notes: booking.notes || booking.service_details || "No additional notes.",
    intro_line: introLine,
    action_line: actionLine,
    shop_name: shop.name,
    shop_address: isMobile ? "Mobile — our team will come to you" : shopDetails.address,
    shop_map_link: isMobile ? "" : shopDetails.mapLink,
    shop_phone: shopDetails.phone,
    shop_email: shopDetails.email,
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
