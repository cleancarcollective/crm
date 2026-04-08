import Link from "next/link";

import { ContactNameLink } from "@/components/dashboard/ContactNameLink";
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
        <div key={booking.id} className="bookingRow">
          <div className="bookingRowMain">
            <div className="bookingTimeBlock">
              <strong>{formatDateTime(booking.scheduled_start, timezone, "h:mm a")}</strong>
              <span>{booking.duration_minutes ? formatMinutes(booking.duration_minutes) : "-"}</span>
            </div>

            <div className="bookingSummaryBlock">
              <div className="bookingSummaryTop">
                <Link href={`/bookings/${booking.id}`} className="profilePrimaryLink">
                  {booking.service_name}
                </Link>
                <StatusBadge status={booking.status} />
              </div>
              <ContactNameLink
                contactId={booking.contact?.id ?? booking.contact_id}
                name={getBookingDisplayName(booking)}
                className="profileNameLink"
              />
              <span>{getVehicleLabel(booking)}</span>
            </div>
          </div>

          <div className="bookingMetaBlock">
            <strong>{formatCurrency(booking.price_estimate)}</strong>
            <span>{booking.location_type ?? "Location not set"}</span>
            <Link href={`/bookings/${booking.id}`} className="profileMetaLink">
              Open booking
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
