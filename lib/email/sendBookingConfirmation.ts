import type { BookingWithRelations, ShopRecord } from "@/lib/dashboard/types";
import type { EmailTemplateKey } from "@/lib/email/types";
import { sendBookingEmail } from "@/lib/email/sendBookingEmail";

export async function sendBookingConfirmationEmail({
  shop,
  booking,
  templateKey = "booking-confirmation",
  introLine = "Your booking with Clean Car Collective Christchurch is confirmed.",
  actionLine = "If you need to make any changes, reply to this email."
}: {
  shop: ShopRecord;
  booking: BookingWithRelations;
  templateKey?: EmailTemplateKey;
  introLine?: string;
  actionLine?: string;
}) {
  return sendBookingEmail({
    shop,
    booking,
    templateKey,
    recipient: booking.contact?.email ?? null,
    introLine,
    actionLine
  });
}
