import type { BookingWithRelations, ShopRecord } from "@/lib/dashboard/types";
import type { EmailTemplateKey } from "@/lib/email/types";
import { sendBookingEmail } from "@/lib/email/sendBookingEmail";

export async function sendBookingConfirmationEmail({
  shop,
  booking,
  templateKey = "booking-confirmation",
  introLine,
  actionLine = "If you need to make any changes, reply to this email."
}: {
  shop: ShopRecord;
  booking: BookingWithRelations;
  templateKey?: EmailTemplateKey;
  introLine?: string;
  actionLine?: string;
}) {
  const resolvedIntroLine = introLine ?? `Your booking with ${shop.name} is confirmed.`;
  return sendBookingEmail({
    shop,
    booking,
    templateKey,
    recipient: booking.contact?.email ?? null,
    introLine: resolvedIntroLine,
    actionLine
  });
}
