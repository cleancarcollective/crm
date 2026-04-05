import Link from "next/link";

import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { getBookingDisplayName, getVehicleLabel } from "@/lib/dashboard/bookings";
import { formatCurrency, formatDateTime, formatMinutes } from "@/lib/dashboard/format";
import type { BookingWithRelations } from "@/lib/dashboard/types";

type BookingListProps = {
  bookings: BookingWithRelations[];
  timezone: string;
};

export function BookingList({ bookings, timezone }: BookingListProps) {
  if (bookings.length === 0) {
    return <div className="emptyState">No bookings for this day.</div>;
  }

  return (
    <div className="listPanel">
      {bookings.map((booking) => (
        <Link key={booking.id} href={`/bookings/${booking.id}`} className="bookingRow">
          <div className="bookingRowMain">
            <div className="bookingTimeBlock">
              <strong>{formatDateTime(booking.scheduled_start, timezone, "h:mm a")}</strong>
              <span>{booking.duration_minutes ? formatMinutes(booking.duration_minutes) : "-"}</span>
            </div>

            <div className="bookingSummaryBlock">
              <div className="bookingSummaryTop">
                <strong>{booking.service_name}</strong>
                <StatusBadge status={booking.status} />
              </div>
              <span>{getBookingDisplayName(booking)}</span>
              <span>{getVehicleLabel(booking)}</span>
            </div>
          </div>

          <div className="bookingMetaBlock">
            <strong>{formatCurrency(booking.price_estimate)}</strong>
            <span>{booking.location_type ?? "Location not set"}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
