import Link from "next/link";

import { ContactDirectoryList } from "@/components/dashboard/ContactDirectoryList";
import { DirectoryFilterBar } from "@/components/dashboard/DirectoryFilterBar";
import { getLeadDirectory } from "@/lib/dashboard/contacts";

function toSearchableText(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; status?: string }>;
}) {
  const { shop, entries } = await getLeadDirectory();
  const params = searchParams ? await searchParams : undefined;
  const query = (params?.q ?? "").trim().toLowerCase();
  const status = (params?.status ?? "").trim().toLowerCase();
  const hasFilters = query.length > 0 || status.length > 0;

  const filteredEntries = entries.filter((entry) => {
    if (status && entry.latestLead.status !== status) {
      return false;
    }

    if (!query) {
      return true;
    }

    const vehicleLabel = entry.latestLead.vehicle
      ? [entry.latestLead.vehicle.year, entry.latestLead.vehicle.make, entry.latestLead.vehicle.model].filter(Boolean).join(" ")
      : "";

    const haystack = [
      entry.contact.full_name,
      entry.contact.first_name,
      entry.contact.last_name,
      entry.contact.email,
      entry.contact.phone,
      entry.latestLead.service_requested,
      entry.latestLead.source,
      entry.latestLead.source_detail,
      vehicleLabel,
    ]
      .map((value) => toSearchableText(value))
      .join(" ");

    return haystack.includes(query);
  });

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Clean Car Collective CRM</p>
          <h1 className="pageTitle">Leads</h1>
          <p className="detailSubtitle">{shop.name}</p>
        </div>
        <div className="topbarMeta directoryNav">
          <Link href="/" className="textLink">
            Calendar
          </Link>
          <Link href="/leads" className="textLink directoryNavActive">
            Leads
          </Link>
          <Link href="/clients" className="textLink">
            Clients
          </Link>
        </div>
      </div>

      <div className="summaryStrip">
        <div className="summaryCard">
          <span>Open leads</span>
          <strong>{filteredEntries.length}</strong>
        </div>
        <div className="summaryCard">
          <span>{hasFilters ? "Showing" : "Definition"}</span>
          <strong>{hasFilters ? `${filteredEntries.length} of ${entries.length}` : "Contacted, not booked"}</strong>
        </div>
        <div className="summaryCard">
          <span>Timezone</span>
          <strong>{shop.timezone}</strong>
        </div>
      </div>

      <DirectoryFilterBar
        action="/leads"
        query={query}
        status={status}
        statusOptions={[
          { label: "All statuses", value: "" },
          { label: "New", value: "new" },
          { label: "Contacted", value: "contacted" },
          { label: "Quoted", value: "quoted" },
          { label: "Clicked", value: "clicked" },
        ]}
      />

      <ContactDirectoryList mode="leads" entries={filteredEntries} timezone={shop.timezone} />
    </main>
  );
}
