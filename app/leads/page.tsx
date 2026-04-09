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
  const { shop, entries, stats } = await getLeadDirectory();
  const params = searchParams ? await searchParams : undefined;
  const query = (params?.q ?? "").trim().toLowerCase();
  const status = (params?.status ?? "").trim().toLowerCase();

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
      entry.latestLead.won_source,
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
          <span>Total leads</span>
          <strong>{stats.totalLeads}</strong>
        </div>
        <div className="summaryCard">
          <span>Open</span>
          <strong>{stats.openLeads}</strong>
        </div>
        <div className="summaryCard">
          <span>Won</span>
          <strong>{stats.wonLeads}</strong>
        </div>
        <div className="summaryCard summaryCardHighlight">
          <span>Conversion rate</span>
          <strong>{stats.conversionRate}%</strong>
        </div>
      </div>

      <DirectoryFilterBar
        action="/leads"
        query={query}
        status={status}
        statusOptions={[
          { label: "All leads", value: "" },
          { label: "New", value: "new" },
          { label: "Contacted", value: "contacted" },
          { label: "Quoted", value: "quoted" },
          { label: "Clicked", value: "clicked" },
          { label: "Won", value: "won" },
          { label: "Lost", value: "lost" },
        ]}
      />

      <ContactDirectoryList mode="leads" entries={filteredEntries} timezone={shop.timezone} />
    </main>
  );
}
