import { addHours, addWeeks, addDays } from "date-fns";

import { getBookingsWithRelationsForRange, getShopBySlug } from "@/lib/dashboard/bookings";
import { sendBookingConfirmationEmail } from "@/lib/email/sendBookingConfirmation";

const DEFAULT_SHOP_SLUG = "christchurch";

const REMINDER_WINDOWS = [
  {
    templateKey: "booking-reminder-week" as const,
    targetStartOffsetHours: 24 * 7,
    introLine: "This is your one-week reminder for your upcoming booking with Clean Car Collective Christchurch.",
    actionLine: "If anything has changed, reply to this email."
  },
  {
    templateKey: "booking-reminder-day" as const,
    targetStartOffsetHours: 24,
    introLine: "This is your one-day reminder for your upcoming booking with Clean Car Collective Christchurch.",
    actionLine: "If anything has changed, reply to this email."
  },
  {
    templateKey: "booking-reminder-hour" as const,
    targetStartOffsetHours: 1,
    introLine: "This is your one-hour reminder for your upcoming booking with Clean Car Collective Christchurch.",
    actionLine: "We look forward to seeing you shortly."
  }
];

export async function processBookingReminders(shopSlug = DEFAULT_SHOP_SLUG) {
  const shop = await getShopBySlug(shopSlug);
  const now = new Date();
  const results: Array<{ templateKey: string; bookingId: string; status: string }> = [];

  for (const reminder of REMINDER_WINDOWS) {
    const windowStart = addHours(now, reminder.targetStartOffsetHours);
    const windowEnd = addHours(windowStart, 1);
    const bookings = await getBookingsWithRelationsForRange(
      shop.id,
      windowStart.toISOString(),
      windowEnd.toISOString()
    );

    for (const booking of bookings) {
      try {
        const result = await sendBookingConfirmationEmail({
          shop,
          booking,
          templateKey: reminder.templateKey,
          introLine: reminder.introLine,
          actionLine: reminder.actionLine
        });

        results.push({
          templateKey: reminder.templateKey,
          bookingId: booking.id,
          status: result.skipped ? `skipped:${result.reason}` : "sent"
        });
      } catch (error) {
        console.error("Booking reminder send failed", {
          bookingId: booking.id,
          templateKey: reminder.templateKey,
          error
        });
        results.push({
          templateKey: reminder.templateKey,
          bookingId: booking.id,
          status: "failed"
        });
      }
    }
  }

  return results;
}
