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

      <BookingDetail booking={booking} shop={shop} />
    </main>
  );
}
