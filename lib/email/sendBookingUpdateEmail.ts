import type { BookingWithRelations, ShopRecord } from "@/lib/dashboard/types";
import { sendBookingEmail } from "@/lib/email/sendBookingEmail";

export async function sendBookingUpdateEmail({
  shop,
  booking,
  changeSummary,
}: {
  shop: ShopRecord;
  booking: BookingWithRelations;
  changeSummary: string;
}) {
  return sendBookingEmail({
    shop,
    booking,
    templateKey: "booking-update",
    recipient: booking.contact?.email ?? null,
    introLine: `Your booking with ${shop.name} has been updated.`,
    actionLine: "Please review the updated booking details below. If anything looks wrong, reply to this email.",
    firstName: booking.contact?.first_name ?? null,
    fullNameOverride: booking.contact?.full_name ?? null,
    updateSummary: changeSummary,
  });
}
