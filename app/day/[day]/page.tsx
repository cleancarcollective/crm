import Link from "next/link";
import { format, parse } from "date-fns";

import { BookingList } from "@/components/dashboard/BookingList";
import { NewBookingButton } from "@/components/dashboard/NewBookingButton";
import { getBookingsForDay } from "@/lib/dashboard/bookings";
import { formatCurrency, formatMinutes } from "@/lib/dashboard/format";

export default async function DayPage({
  params
}: {
  params: Promise<{ day: string }>;
}) {
  const { day } = await params;
  const { shop, bookings } = await getBookingsForDay(day);
  const parsedDay = parse(day, "yyyy-MM-dd", new Date());

  const totalRevenue = bookings.reduce((sum, booking) => sum + (booking.price_estimate ?? 0), 0);
  const totalMinutes = bookings.reduce((sum, booking) => sum + (booking.duration_minutes ?? 0), 0);
  const monthKey = format(parsedDay, "yyyy-MM");

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <Link href={`/?month=${monthKey}`} className="textLink">
            Back to month
          </Link>
          <h1 className="pageTitle">{format(parsedDay, "EEEE d MMMM yyyy")}</h1>
        </div>
        <NewBookingButton defaultDate={day} label="+ New Booking" className="buttonPrimary" />
      </div>

      <div className="summaryStrip">
        <div className="summaryCard">
          <span>Bookings</span>
          <strong>{bookings.length}</strong>
        </div>
        <div className="summaryCard">
          <span>Est. Revenue</span>
          <strong>{formatCurrency(totalRevenue)}</strong>
        </div>
        <div className="summaryCard">
          <span>Booked Time</span>
          <strong>{formatMinutes(totalMinutes)}</strong>
        </div>
      </div>

      <BookingList bookings={bookings} timezone={shop.timezone} />
    </main>
  );
}
