import type { BookingWithRelations, ShopRecord } from "@/lib/dashboard/types";
import { sendBookingEmail } from "@/lib/email/sendBookingEmail";
import { getShopContacts } from "@/lib/email/shopContacts";

export async function sendTeamBookingNotification({
  shop,
  booking
}: {
  shop: ShopRecord;
  booking: BookingWithRelations;
}) {
  const { team_email } = getShopContacts(shop);

  return sendBookingEmail({
    shop,
    booking,
    templateKey: "booking-team-notification",
    recipient: team_email,
    introLine: "A new booking has been created in the CRM.",
    actionLine: "Review this booking in the CRM calendar if any prep or follow-up is required.",
    firstName: "team",
    fullNameOverride: "Clean Car Collective team",
    includeCustomerDetails: true
  });
}
