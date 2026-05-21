import Link from "next/link";
import { redirect } from "next/navigation";

import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSalesQueue, type SalesRange } from "@/lib/dashboard/salesLeads";

const RANGE_OPTIONS: Array<{ value: SalesRange; label: string }> = [
  { value: "7-30d", label: "7 to 30 days" },
  { value: "30-90d", label: "30 to 90 days" },
  { value: "90-180d", label: "90 to 180 days" },
  { value: "all", label: "All (7 to 180 days)" },
];

export default async function SalesPage({
  searchParams,
}: {
  searchParams?: Promise<{ range?: string; service?: string; untouched?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Admin/sales only. Contractor doesn't get this view.
  if (user.role !== "admin" && user.role !== "sales") {
    redirect("/");
  }

  // Sales users always operate on their assigned shop. Admins use the
  // current active shop.
  const shopForQueue = user.role === "sales" ? user.assignedShop ?? user.shop : user.shop;

  const params = (await searchParams) ?? {};
  const rangeRaw = (params.range ?? "all").trim();
  const range: SalesRange = (["7-30d", "30-90d", "90-180d", "all"].includes(rangeRaw) ? rangeRaw : "all") as SalesRange;
  const service = (params.service ?? "").trim() || undefined;
  const untouchedOnly = params.untouched === "1" || params.untouched === "true";

  const { entries, bucketCounts, totalShown } = await getSalesQueue({
    shopId: shopForQueue.id,
    range,
    service,
    untouchedOnly,
  });

  const isAdmin = user.role === "admin";

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Cold-lead caller</p>
          <h1 className="pageTitle">Sales queue</h1>
          <p className="detailSubtitle">{shopForQueue.name} · {totalShown} callable lead{totalShown === 1 ? "" : "s"}</p>
        </div>
        {isAdmin ? (
          <div className="topbarMeta">
            <Link
              href={`/api/sales/export?range=${range}${service ? `&service=${encodeURIComponent(service)}` : ""}${untouchedOnly ? "&untouched=1" : ""}`}
              className="buttonGhost"
            >
              Export CSV
            </Link>
            {/* TODO: build /sales/stats page (admin attribution metrics) */}
          </div>
        ) : null}
      </div>

      <div className="summaryStrip">
        <div className="summaryCard">
          <span>7 to 30 days</span>
          <strong>{bucketCounts["7-30d"]}</strong>
        </div>
        <div className="summaryCard">
          <span>30 to 90 days</span>
          <strong>{bucketCounts["30-90d"]}</strong>
        </div>
        <div className="summaryCard">
          <span>90 to 180 days</span>
          <strong>{bucketCounts["90-180d"]}</strong>
        </div>
        <div className="summaryCard summaryCardHighlight">
          <span>All open enquiries</span>
          <strong>{bucketCounts.all}</strong>
        </div>
      </div>

      <form className="directoryFilterBar" method="get" action="/sales">
        <label className="modalField">
          <span>Range</span>
          <select className="detailInput" name="range" defaultValue={range}>
            {RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label className="modalField">
          <span>Service</span>
          <input className="detailInput" name="service" defaultValue={service ?? ""} placeholder="e.g. detail, wash" />
        </label>
        <label className="modalField" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" name="untouched" value="1" defaultChecked={untouchedOnly} />
          <span>Only untouched 14d+</span>
        </label>
        <button type="submit" className="buttonPrimary">Apply</button>
      </form>

      <section className="detailPanel">
        {entries.length === 0 ? (
          <p className="profileEmpty">No callable leads in this window.</p>
        ) : (
          <table className="staffTable">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th>Vehicle</th>
                <th>Service</th>
                <th>Days since enquiry</th>
                <th>Last touched</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.leadId}>
                  <td>
                    <Link href={`/contacts/${e.contactId}` as `/contacts/${string}`} className="profilePrimaryLink">
                      {e.contactName ?? "(no name)"}
                    </Link>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {e.phone ? <a href={`tel:${e.phone}`} className="textLink">{e.phone}</a> : <span style={{ color: "#9e9189" }}>no phone</span>}
                      {e.email ? <a href={`mailto:${e.email}`} className="textLink" style={{ fontSize: 12 }}>{e.email}</a> : null}
                    </div>
                  </td>
                  <td>{e.vehicleLabel ?? <span style={{ color: "#9e9189" }}>—</span>}</td>
                  <td>{e.serviceRequested ?? <span style={{ color: "#9e9189" }}>—</span>}</td>
                  <td>{e.daysSinceEnquiry}d</td>
                  <td>{relativeAge(e.lastTouchedAt)}</td>
                  <td><StatusBadge status={e.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}
