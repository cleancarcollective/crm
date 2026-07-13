import Link from "next/link";

import { ContactNameLink } from "@/components/dashboard/ContactNameLink";
import { formatCurrency, formatMinutes } from "@/lib/dashboard/format";
import type { CalendarDaySummary } from "@/lib/dashboard/types";

type BookingCalendarProps = {
  monthLabel: string;
  previousMonth: string;
  nextMonth: string;
  days: CalendarDaySummary[];
};

const WEEK_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function BookingCalendar({ monthLabel, previousMonth, nextMonth, days }: BookingCalendarProps) {
  return (
    <section className="calendarShell">
      <div className="calendarHeader">
        <Link href={`/?month=${previousMonth}`} className="calendarNav">
          Prev
        </Link>
        <div className="calendarTitleWrap">
          <h1 className="calendarTitle">{monthLabel}</h1>
          <p className="calendarSubtitle">Monthly booking board</p>
        </div>
        <Link href={`/?month=${nextMonth}`} className="calendarNav">
          Next
        </Link>
      </div>

      <div className="weekHeader">
        {WEEK_DAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="calendarGrid">
        {days.map((day) => (
          <div
            key={day.isoDate}
            className={[
              "calendarCard",
              day.isCurrentMonth ? "" : "calendarCardMuted",
              day.isToday ? "calendarCardToday" : ""
            ].join(" ")}
          >
            <Link href={`/day/${day.isoDate}`} className="calendarCardPrimaryLink">
              <div className="calendarCardTop">
                <span className="calendarDayNumber">{Number(day.isoDate.slice(-2))}</span>
                {day.bookingCount > 0 ? <span className="calendarBookingCount">{day.bookingCount}</span> : null}
              </div>

              {day.bookingCount > 0 ? (
                <div className="calendarMetrics">
                  <strong>{formatCurrency(day.totalRevenue)}</strong>
                  <span>{formatMinutes(day.totalDurationMinutes)}</span>
                </div>
              ) : (
                <div className="calendarEmpty">No bookings</div>
              )}
            </Link>

            {(day.continuationBookings ?? []).slice(0, 3).map((booking) => {
              const isMobile = (booking.location_type ?? "").toLowerCase().includes("mobile");
              return (
                <div
                  key={`cont-${booking.id}`}
                  className="calendarPreview calendarPreview--continuation"
                  title={`Continues from ${booking.scheduled_start.slice(0, 10)} · ${booking.duration_minutes ?? "?"}m total`}
                  style={{ opacity: 0.7, fontStyle: "italic" }}
                >
                  <span>
                    → cont.{isMobile ? " 🚐" : ""} {booking.service_name}
                  </span>
                  <ContactNameLink
                    contactId={booking.contact?.id ?? booking.contact_id}
                    name={booking.contact?.full_name ?? booking.contact?.first_name ?? "Customer"}
                    className="profileNameLink"
                  />
                </div>
              );
            })}

            {day.bookings.slice(0, 3).map((booking) => {
              // Mobile jobs get a distinct red bar so staff can spot them
              // at a glance (matches the van livery).
              const isMobile = (booking.location_type ?? "").toLowerCase().includes("mobile");
              // Reschedule requested via customer self-service: the
              // booking-action route writes "[Reschedule requested]" into
              // notes. Flag visually so staff knows to action it.
              const needsReschedule = !!booking.notes?.includes("[Reschedule requested]");
              const isRecurring = !!booking.series_id;
              const classes = [
                "calendarPreview",
                isMobile ? "calendarPreview--mobile" : "",
                needsReschedule ? "calendarPreview--reschedule" : "",
              ].filter(Boolean).join(" ");
              const tooltipParts: string[] = [];
              if (isMobile && booking.service_address) tooltipParts.push(`Mobile — ${booking.service_address}`);
              if (needsReschedule) tooltipParts.push("Customer requested a reschedule — open booking to confirm");
              if (isRecurring) tooltipParts.push("Part of recurring series");
              return (
                <div
                  key={booking.id}
                  className={classes}
                  title={tooltipParts.length ? tooltipParts.join(" · ") : undefined}
                >
                  <span>
                    {needsReschedule ? "🔄 " : ""}
                    {isMobile ? "🚐 " : ""}
                    {isRecurring ? "↻ " : ""}
                    {booking.service_name}
                  </span>
                  <ContactNameLink
                    contactId={booking.contact?.id ?? booking.contact_id}
                    name={booking.contact?.full_name ?? booking.contact?.first_name ?? "Customer"}
                    className="profileNameLink"
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
