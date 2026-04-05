import { formatInTimeZone } from "date-fns-tz";

import { getBookingDisplayName, getVehicleLabel } from "@/lib/dashboard/bookings";
import { formatCurrency } from "@/lib/dashboard/format";
import type { BookingWithRelations, ShopRecord } from "@/lib/dashboard/types";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { renderTemplate } from "@/lib/email/templateRenderer";
import type { EmailTemplateRecord } from "@/lib/email/types";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function getRequiredEnv(name: "POSTMARK_FROM_EMAIL") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export async function sendBookingConfirmationEmail({
  shop,
  booking
}: {
  shop: ShopRecord;
  booking: BookingWithRelations;
}) {
  const recipient = booking.contact?.email;

  if (!recipient) {
    return { skipped: true as const, reason: "missing_recipient" };
  }

  const template = await getEmailTemplate(shop.id, "booking-confirmation");

  if (!template || !template.is_active) {
    return { skipped: true as const, reason: "missing_template" };
  }

  const rendered = renderTemplate(template, {
    first_name: booking.contact?.first_name ?? "there",
    full_name: getBookingDisplayName(booking),
    service_name: booking.service_name,
    scheduled_date: formatInTimeZone(booking.scheduled_start, shop.timezone, "EEEE d MMMM yyyy"),
    scheduled_time: formatInTimeZone(booking.scheduled_start, shop.timezone, "h:mm a"),
    vehicle_label: getVehicleLabel(booking),
    location_type: booking.location_type ?? "To be confirmed",
    price_estimate: formatCurrency(booking.price_estimate),
    notes: booking.notes || booking.service_details || "No additional notes."
  });

  const messageRecord = await createQueuedEmailMessage({
    shopId: shop.id,
    contactId: booking.contact_id,
    bookingId: booking.id,
    templateId: template.id,
    subject: rendered.subject,
    body: rendered.body
  });

  try {
    const postmark = getPostmarkClient();
    const response = await postmark.sendEmail({
      From: getRequiredEnv("POSTMARK_FROM_EMAIL"),
      To: recipient,
      Subject: rendered.subject,
      TextBody: rendered.body,
      MessageStream: "outbound",
      Metadata: {
        email_message_id: messageRecord.id,
        booking_id: booking.id,
        shop_id: shop.id
      }
    });

    await updateEmailMessageSent({
      id: messageRecord.id,
      providerMessageId: response.MessageID
    });

    return { skipped: false as const, emailMessageId: messageRecord.id, providerMessageId: response.MessageID };
  } catch (error) {
    await updateEmailMessageFailed({
      id: messageRecord.id
    });

    throw error;
  }
}

async function getEmailTemplate(shopId: string, key: string) {
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
