import { getMemberAlert, memberAlertEmail } from "@/lib/collective/memberAlert";
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

  // Collective members get a big banner + subject prefix so the team
  // sees their plan and washes-this-year before anything else.
  const member = await getMemberAlert(booking.contact_id, shop.timezone || undefined);
  const topAlert = member
    ? memberAlertEmail(member, new Date(booking.scheduled_start) <= new Date())
    : null;

  return sendBookingEmail({
    shop,
    booking,
    templateKey: "booking-team-notification",
    recipient: team_email,
    introLine: "A new booking has been created in the CRM.",
    actionLine: "Review this booking in the CRM calendar if any prep or follow-up is required.",
    firstName: "team",
    fullNameOverride: "Clean Car Collective team",
    includeCustomerDetails: true,
    topAlert
  });
}
