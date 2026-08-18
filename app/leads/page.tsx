
import { ContactDirectoryList } from "@/components/dashboard/ContactDirectoryList";
import { DirectoryFilterBar } from "@/components/dashboard/DirectoryFilterBar";
import { DirectoryPagination } from "@/components/dashboard/DirectoryPagination";
import { ImportExportBar } from "@/components/dashboard/ImportExportBar";
import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getLeadDirectoryPage } from "@/lib/dashboard/contacts";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const currentShop = await requireCurrentShop();
  const params = searchParams ? await searchParams : undefined;
  const query = (params?.q ?? "").trim();
  const status = (params?.status ?? "").trim().toLowerCase();
  const page = Math.max(1, Number(params?.page ?? "1") | 0);

  const { shop, entries, stats, totalPages } = await getLeadDirectoryPage({
    shopSlug: currentShop.slug,
    query,
    status,
    page,
  });

  const buildHref = (p: number) => {
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    if (status) sp.set("status", status);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `/leads?${qs}` : "/leads";
  };

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Clean Car Collective CRM</p>
          <h1 className="pageTitle">Leads</h1>
          <p className="detailSubtitle">{shop.name}</p>
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
          // Needs approval sits first: these are the only ones waiting on us.
          { label: "Needs approval", value: "needs_approval" },
          { label: "New", value: "new" },
          { label: "Contacted", value: "contacted" },
          // "Quoted" was a dead option - no lead has ever carried that status.
          // The quote-sent state is "sent".
          { label: "Quote sent", value: "sent" },
          { label: "Clicked", value: "clicked" },
          { label: "Won", value: "won" },
          { label: "Lost", value: "lost" },
        ]}
      />

      <ImportExportBar mode="leads" exportParams={status || query ? `?status=${status}&q=${query}` : ""} />

      <ContactDirectoryList mode="leads" entries={entries} timezone={shop.timezone} />

      <DirectoryPagination page={page} totalPages={totalPages} buildHref={buildHref} />
    </main>
  );
}
