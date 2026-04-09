import Link from "next/link";

import { ContactDirectoryList } from "@/components/dashboard/ContactDirectoryList";
import { DirectoryFilterBar } from "@/components/dashboard/DirectoryFilterBar";
import { getClientDirectory } from "@/lib/dashboard/contacts";
import { formatCurrency } from "@/lib/dashboard/format";

function toSearchableText(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; status?: string; from?: string; to?: string }>;
}) {
  const { shop, entries } = await getClientDirectory();
  const params = searchParams ? await searchParams : undefined;
  const query = (params?.q ?? "").trim().toLowerCase();
  const status = (params?.status ?? "").trim().toLowerCase();
  const dateFrom = (params?.from ?? "").trim();
  const dateTo = (params?.to ?? "").trim();
  const hasFilters = query.length > 0 || status.length > 0 || dateFrom.length > 0 || dateTo.length > 0;

  const fromDate = dateFrom ? new Date(dateFrom) : null;
  const toDate = dateTo ? new Date(dateTo + "T23:59:59") : null;

  const filteredEntries = entries.filter((entry) => {
    if (status && entry.latestBooking.status !== status) return false;

    if (fromDate || toDate) {
      const bookingDate = new Date(entry.latestBooking.scheduled_start);
      if (fromDate && bookingDate < fromDate) return false;
      if (toDate && bookingDate > toDate) return false;
    }

    if (!query) return true;

    const vehicleLabel = entry.latestBooking.vehicle
      ? [entry.latestBooking.vehicle.year, entry.latestBooking.vehicle.make, entry.latestBooking.vehicle.model].filter(Boolean).join(" ")
      : "";

    const haystack = [
      entry.contact.full_name,
      entry.contact.first_name,
      entry.contact.last_name,
      entry.contact.email,
      entry.contact.phone,
      entry.latestBooking.service_name,
      entry.latestBooking.location_type,
      vehicleLabel,
    ]
      .map((value) => toSearchableText(value))
      .join(" ");

    return haystack.includes(query);
  });

  const totalRevenue = filteredEntries.reduce((sum, entry) => sum + entry.totalRevenue, 0);
  const totalBookings = filteredEntries.reduce((sum, entry) => sum + entry.bookingCount, 0);

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Clean Car Collective CRM</p>
          <h1 className="pageTitle">Clients</h1>
          <p className="detailSubtitle">{shop.name}</p>
        </div>
        <div className="topbarMeta directoryNav">
          <Link href="/" className="textLink">Calendar</Link>
          <Link href="/leads" className="textLink">Leads</Link>
          <Link href="/clients" className="textLink directoryNavActive">Clients</Link>
        </div>
      </div>

      <div className="summaryStrip">
        <div className="summaryCard">
          <span>Clients</span>
          <strong>{filteredEntries.length}</strong>
        </div>
        <div className="summaryCard">
          <span>{hasFilters ? "Bookings shown" : "Bookings"}</span>
          <strong>{hasFilters ? `${totalBookings} across ${filteredEntries.length}` : totalBookings}</strong>
        </div>
        <div className="summaryCard">
          <span>Est. Revenue</span>
          <strong>{formatCurrency(totalRevenue)}</strong>
        </div>
      </div>

      <DirectoryFilterBar
        action="/clients"
        query={query}
        status={status}
        dateFrom={dateFrom}
        dateTo={dateTo}
        showDateRange={true}
        statusOptions={[
          { label: "All statuses", value: "" },
          { label: "Confirmed", value: "confirmed" },
          { label: "Pending", value: "pending" },
          { label: "Reminder sent", value: "reminder_sent" },
          { label: "Completed", value: "completed" },
          { label: "Cancelled", value: "cancelled" },
          { label: "No show", value: "no_show" },
        ]}
      />

      <ContactDirectoryList mode="clients" entries={filteredEntries} timezone={shop.timezone} />
    </main>
  );
}
