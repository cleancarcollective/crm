import Link from "next/link";

import { ContactDirectoryList } from "@/components/dashboard/ContactDirectoryList";
import { DirectoryFilterBar } from "@/components/dashboard/DirectoryFilterBar";
import { DirectoryPagination } from "@/components/dashboard/DirectoryPagination";
import { ImportExportBar } from "@/components/dashboard/ImportExportBar";
import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getClientDirectoryPage } from "@/lib/dashboard/contacts";
import { formatCurrency } from "@/lib/dashboard/format";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; status?: string; from?: string; to?: string; page?: string }>;
}) {
  const currentShop = await requireCurrentShop();
  const params = searchParams ? await searchParams : undefined;
  const query = (params?.q ?? "").trim();
  const status = (params?.status ?? "").trim().toLowerCase();
  const dateFrom = (params?.from ?? "").trim();
  const dateTo = (params?.to ?? "").trim();
  const page = Math.max(1, Number(params?.page ?? "1") | 0);

  const { shop, entries, totalPages, totalRevenue, totalBookings } = await getClientDirectoryPage({
    shopSlug: currentShop.slug,
    query,
    status,
    dateFrom,
    dateTo,
    page,
  });

  const hasFilters = query.length > 0 || status.length > 0 || dateFrom.length > 0 || dateTo.length > 0;

  const buildHref = (p: number) => {
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    if (status) sp.set("status", status);
    if (dateFrom) sp.set("from", dateFrom);
    if (dateTo) sp.set("to", dateTo);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `/clients?${qs}` : "/clients";
  };

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
          <span>Bookings shown</span>
          <strong>{totalBookings}</strong>
        </div>
        <div className="summaryCard">
          <span>{hasFilters ? "Page" : "Total pages"}</span>
          <strong>{page} / {totalPages}</strong>
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

      <ImportExportBar mode="clients" exportParams={query ? `?q=${query}` : ""} />

      <ContactDirectoryList mode="clients" entries={entries} timezone={shop.timezone} />

      <DirectoryPagination page={page} totalPages={totalPages} buildHref={buildHref} />
    </main>
  );
}
