import Link from "next/link";

import { BookingDetail } from "@/components/dashboard/BookingDetail";
import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getBookingById } from "@/lib/dashboard/bookings";

export default async function BookingDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const currentShop = await requireCurrentShop();
  const { shop, booking } = await getBookingById(id, currentShop.slug);

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <Link href="/" className="textLink">
            Back to calendar
          </Link>
        </div>
      </div>

      {booking.series_id ? (
        <div
          style={{
            margin: "0 0 16px 0",
            padding: "10px 14px",
            background: "#fef6e7",
            border: "1px solid #f0d68b",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 14,
          }}
        >
          <span>
            ↻ Part of a recurring series
            {booking.series_sequence !== null ? ` — occurrence #${(booking.series_sequence ?? 0) + 1}` : ""}
          </span>
          {/* /series/[id] page does not exist yet (step 5 of the build).
              Cast through unknown because typed routes won't recognise it. */}
          <Link href={(`/series/${booking.series_id}` as unknown) as never} className="textLink">
            View series →
          </Link>
        </div>
      ) : null}

      <BookingDetail booking={booking} shop={shop} />
    </main>
  );
}
