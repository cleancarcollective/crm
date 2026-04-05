import Link from "next/link";

import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { getBookingDisplayName, getVehicleLabel, getZonedDateKey } from "@/lib/dashboard/bookings";
import { formatCurrency, formatDateTime, formatMinutes } from "@/lib/dashboard/format";
import type { BookingWithRelations, ShopRecord } from "@/lib/dashboard/types";

type BookingDetailProps = {
  booking: BookingWithRelations;
  shop: ShopRecord;
};

function DetailItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="detailItem">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

export function BookingDetail({ booking, shop }: BookingDetailProps) {
  const dayKey = getZonedDateKey(booking.scheduled_start, shop.timezone);

  return (
    <section className="detailShell">
      <div className="detailHeader">
        <div>
          <Link href={`/day/${dayKey}`} className="textLink">
            Back to day
          </Link>
          <h1 className="detailTitle">{booking.service_name}</h1>
          <p className="detailSubtitle">{getBookingDisplayName(booking)}</p>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      <div className="detailGrid">
        <div className="detailPanel">
          <h2>Booking</h2>
          <DetailItem label="Start" value={formatDateTime(booking.scheduled_start, shop.timezone)} />
          <DetailItem
            label="End"
            value={booking.scheduled_end ? formatDateTime(booking.scheduled_end, shop.timezone) : null}
          />
          <DetailItem label="Duration" value={booking.duration_minutes ? formatMinutes(booking.duration_minutes) : null} />
          <DetailItem label="Price" value={formatCurrency(booking.price_estimate)} />
          <DetailItem label="Location" value={booking.location_type} />
          <DetailItem label="Source" value={booking.booking_source} />
          <DetailItem label="Service ID" value={booking.service_id} />
        </div>

        <div className="detailPanel">
          <h2>Contact</h2>
          <DetailItem label="Name" value={getBookingDisplayName(booking)} />
          <DetailItem label="Email" value={booking.contact?.email ?? null} />
          <DetailItem label="Phone" value={booking.contact?.phone ?? null} />

          <h2 className="detailSubheading">Vehicle</h2>
          <DetailItem label="Vehicle" value={getVehicleLabel(booking)} />
          <DetailItem label="Size" value={booking.vehicle?.size ?? null} />
          <DetailItem label="Rego" value={booking.vehicle?.rego ?? null} />
        </div>
      </div>

      <div className="detailPanel">
        <h2>Notes</h2>
        <p className="detailText">{booking.notes || booking.service_details || "No notes recorded."}</p>
      </div>

      <div className="detailPanel">
        <h2>Raw Payload</h2>
        <pre className="payloadBox">{JSON.stringify(booking.raw_payload, null, 2)}</pre>
      </div>
    </section>
  );
}
