import Link from "next/link";

import { BookingCalendar } from "@/components/dashboard/BookingCalendar";
import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getBookingsForMonth } from "@/lib/dashboard/bookings";
import { formatCurrency, formatMonthLabel } from "@/lib/dashboard/format";

export default async function HomePage({
  searchParams
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const currentShop = await requireCurrentShop();
  const { shop, month, previous, next, days } = await getBookingsForMonth(params?.month, currentShop.slug);

  // Only sum days that belong to the displayed month. The calendar grid runs
  // from the Sunday before the 1st to the Saturday after the last day, so it
  // carries leading days from the previous month and trailing days from the
  // next one; those must not count toward this month's totals.
  const totalRevenue = days.reduce(
    (sum, day) => sum + (day.isCurrentMonth ? day.totalRevenue : 0),
    0
  );
  const totalBookings = days.reduce(
    (sum, day) => sum + (day.isCurrentMonth ? day.bookingCount : 0),
    0
  );

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Clean Car Collective CRM</p>
          <h1 className="pageTitle">{shop.name}</h1>
        </div>
        <div className="topbarMeta directoryNav">
          <Link href="/leads" className="textLink">
            Leads
          </Link>
          <Link href="/clients" className="textLink">
            Clients
          </Link>
          <Link href="/?month" className="textLink">
            Current month
          </Link>
          <span>{shop.timezone}</span>
        </div>
      </div>

      <div className="summaryStrip">
        <div className="summaryCard">
          <span>Month</span>
          <strong>{formatMonthLabel(month, shop.timezone)}</strong>
        </div>
        <div className="summaryCard">
          <span>Bookings</span>
          <strong>{totalBookings}</strong>
        </div>
        <div className="summaryCard">
          <span>Est. Revenue</span>
          <strong>{formatCurrency(totalRevenue)}</strong>
        </div>
      </div>

      <BookingCalendar
        monthLabel={formatMonthLabel(month, shop.timezone)}
        previousMonth={previous}
        nextMonth={next}
        days={days}
      />
    </main>
  );
}
