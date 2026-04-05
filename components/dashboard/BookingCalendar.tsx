import Link from "next/link";

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
          <Link
            key={day.isoDate}
            href={`/day/${day.isoDate}`}
            className={[
              "calendarCard",
              day.isCurrentMonth ? "" : "calendarCardMuted",
              day.isToday ? "calendarCardToday" : ""
            ].join(" ")}
          >
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

            {day.bookings.slice(0, 3).map((booking) => (
              <div key={booking.id} className="calendarPreview">
                <span>{booking.service_name}</span>
                <span>{booking.contact?.full_name ?? booking.contact?.first_name ?? "Customer"}</span>
              </div>
            ))}
          </Link>
        ))}
      </div>
    </section>
  );
}
