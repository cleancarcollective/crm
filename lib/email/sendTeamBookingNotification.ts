import type { BookingWithRelations, ShopRecord } from "@/lib/dashboard/types";
import { sendBookingEmail } from "@/lib/email/sendBookingEmail";

function getRequiredEnv(name: "TEAM_BOOKING_NOTIFICATION_EMAIL") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export async function sendTeamBookingNotification({
  shop,
  booking
}: {
  shop: ShopRecord;
  booking: BookingWithRelations;
}) {
  return sendBookingEmail({
    shop,
    booking,
    templateKey: "booking-team-notification",
    recipient: getRequiredEnv("TEAM_BOOKING_NOTIFICATION_EMAIL"),
    introLine: "A new booking has been created in the CRM and needs team visibility.",
    actionLine: "Review this booking in the CRM calendar if any prep or follow-up is required.",
    firstName: "team",
    fullNameOverride: "Clean Car Collective team"
  });
}
