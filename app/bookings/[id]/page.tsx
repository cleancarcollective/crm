import Link from "next/link";

import { BookingDetail } from "@/components/dashboard/BookingDetail";
import { getBookingById } from "@/lib/dashboard/bookings";

export default async function BookingDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { shop, booking } = await getBookingById(id);

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <Link href="/" className="textLink">
            Back to calendar
          </Link>
        </div>
      </div>

      <BookingDetail booking={booking} shop={shop} />
    </main>
  );
}
