import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { CooldownControls } from "@/components/dashboard/CooldownControls";
import { LeadDispositionActions } from "@/components/dashboard/LeadDispositionActions";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { getCurrentUser } from "@/lib/auth/currentShop";
import {
  getSalesQueue,
  type SalesBucket,
  type SalesRange,
} from "@/lib/dashboard/salesLeads";

const RANGE_OPTIONS: Array<{ value: SalesRange; label: string }> = [
  { value: "7-30d", label: "7 to 30 days" },
  { value: "30-90d", label: "30 to 90 days" },
  { value: "90-180d", label: "90 to 180 days" },
  { value: "all", label: "All (7 to 180 days)" },
];

const BUCKET_TABS: Array<{ value: SalesBucket; label: string; sub: string }> = [
  { value: "warm", label: "Warm", sub: "Inbound today" },
  { value: "cold", label: "Cold", sub: "1-14 days old" },
  { value: "frozen", label: "Frozen", sub: "Older than 14d" },
  { value: "cooldown", label: "Cool down", sub: "Held back" },
];

function isBucket(v: string): v is SalesBucket {
  return v === "warm" || v === "cold" || v === "frozen" || v === "cooldown";
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams?: Promise<{ bucket?: string; range?: string; service?: string; untouched?: string; mode?: string }>;
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
  const bucketRaw = (params.bucket ?? "cold").trim();
  const bucket: SalesBucket = isBucket(bucketRaw) ? bucketRaw : "cold";
  const rangeRaw = (params.range ?? "all").trim();
  const range: SalesRange = (["7-30d", "30-90d", "90-180d", "all"].includes(rangeRaw) ? rangeRaw : "all") as SalesRange;
  const service = (params.service ?? "").trim() || undefined;
  const untouchedOnly = params.untouched === "1" || params.untouched === "true";
  const modeRaw = (params.mode ?? "active").trim();
  const mode: "active" | "orbis" | "all" =
    modeRaw === "orbis" ? "orbis" : modeRaw === "all" ? "all" : "active";

  const { entries, bucketCounts, rangeCounts, totalShown } = await getSalesQueue({
    shopId: shopForQueue.id,
    bucket,
    range,
    service,
    untouchedOnly,
    mode,
  });

  const isAdmin = user.role === "admin";
  const isSales = user.role === "sales";

  function bucketHref(b: SalesBucket): Route {
    const sp = new URLSearchParams();
    sp.set("bucket", b);
    if (service) sp.set("service", service);
    // Range/mode/untouched only carry over for cold — they don't change
    // the warm/frozen/cooldown queries.
    if (b === "cold") {
      if (range !== "all") sp.set("range", range);
      if (mode !== "active") sp.set("mode", mode);
      if (untouchedOnly) sp.set("untouched", "1");
    }
    return `/sales?${sp.toString()}` as Route;
  }

  const currentBucketLabel = BUCKET_TABS.find((t) => t.value === bucket)?.label ?? "Sales queue";

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">{currentBucketLabel} leads</p>
          <h1 className="pageTitle">Sales queue</h1>
          <p className="detailSubtitle">{shopForQueue.name} · {totalShown} lead{totalShown === 1 ? "" : "s"}</p>
        </div>
        {isAdmin ? (
          <div className="topbarMeta">
            <Link
              href={`/api/sales/export?range=${range}${service ? `&service=${encodeURIComponent(service)}` : ""}${untouchedOnly ? "&untouched=1" : ""}`}
              className="buttonGhost"
            >
              Export CSV
            </Link>
            <Link href={"/sales/stats" as Route} className="buttonGhost">
              Sales stats
            </Link>
          </div>
        ) : null}
      </div>

      {/* Bucket tabs — primary navigation between the four lead pages. */}
      <div className="summaryStrip">
        {BUCKET_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={bucketHref(tab.value)}
            className={`summaryCard${bucket === tab.value ? " summaryCardHighlight" : ""}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <span>{tab.label}</span>
            <strong>{bucketCounts[tab.value]}</strong>
            <span style={{ fontSize: 11, color: "#9e9189" }}>{tab.sub}</span>
          </Link>
        ))}
      </div>

      {/* Cold-bucket only: keep the existing mode-switcher + range filter. */}
      {bucket === "cold" ? (
        <>
          <div className="summaryStrip" style={{ marginTop: 8 }}>
            <Link
              href={`/sales?bucket=cold&mode=active${service ? `&service=${encodeURIComponent(service)}` : ""}` as Route}
              className={`summaryCard${mode === "active" ? " summaryCardHighlight" : ""}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <span>Recent enquiries</span>
              <strong>{rangeCounts.all}</strong>
              <span style={{ fontSize: 11, color: "#9e9189" }}>Website, 7-180d</span>
            </Link>
            <Link
              href={`/sales?bucket=cold&mode=orbis${service ? `&service=${encodeURIComponent(service)}` : ""}` as Route}
              className={`summaryCard${mode === "orbis" ? " summaryCardHighlight" : ""}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <span>OrbisX archive</span>
              <strong>{rangeCounts.orbis}</strong>
              <span style={{ fontSize: 11, color: "#9e9189" }}>Imported history</span>
            </Link>
            <Link
              href={`/sales?bucket=cold&mode=all${service ? `&service=${encodeURIComponent(service)}` : ""}` as Route}
              className={`summaryCard${mode === "all" ? " summaryCardHighlight" : ""}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <span>Everything</span>
              <strong>{rangeCounts.all + rangeCounts.orbis}</strong>
              <span style={{ fontSize: 11, color: "#9e9189" }}>Both pools</span>
            </Link>
          </div>

          <form className="directoryFilterBar" method="get" action="/sales">
            <input type="hidden" name="bucket" value="cold" />
            <input type="hidden" name="mode" value={mode} />
            {mode !== "orbis" ? (
              <label className="modalField">
                <span>Range</span>
                <select className="detailInput" name="range" defaultValue={range}>
                  {RANGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
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
        </>
      ) : (
        <form className="directoryFilterBar" method="get" action="/sales">
          <input type="hidden" name="bucket" value={bucket} />
          <label className="modalField">
            <span>Service</span>
            <input className="detailInput" name="service" defaultValue={service ?? ""} placeholder="e.g. detail, wash" />
          </label>
          <button type="submit" className="buttonPrimary">Apply</button>
        </form>
      )}

      <section className="detailPanel">
        {entries.length === 0 ? (
          <p className="profileEmpty">
            {bucket === "warm"
              ? "No leads in today yet."
              : bucket === "cooldown"
              ? "No leads on cool-down right now."
              : bucket === "frozen"
              ? "No frozen leads in this view."
              : "No callable leads in this window."}
          </p>
        ) : (
          <table className="staffTable">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th>Vehicle</th>
                <th>Service</th>
                {isSales ? (
                  <th style={{ minWidth: 360 }}>{bucket === "cooldown" ? "Cool-down" : "Disposition"}</th>
                ) : (
                  <>
                    <th>Days since enquiry</th>
                    <th>Last touched</th>
                    <th>Status</th>
                    <th>{bucket === "cooldown" ? "Cool-down" : "Action"}</th>
                  </>
                )}
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
                  {isSales ? (
                    <td>
                      <LeadDispositionActions
                        leadId={e.leadId}
                        contactId={e.contactId}
                        currentStatus={e.status}
                        currentDisposition={e.lastDisposition}
                        cooldownUntil={e.cooldownUntil}
                        cooldownReason={e.cooldownReason}
                        variant="compact"
                      />
                    </td>
                  ) : (
                    <>
                      <td>{e.daysSinceEnquiry}d</td>
                      <td>{relativeAge(e.lastTouchedAt)}</td>
                      <td><StatusBadge status={e.status} /></td>
                      <td>
                        <CooldownControls
                          leadId={e.leadId}
                          cooldownUntil={e.cooldownUntil}
                          cooldownReason={e.cooldownReason}
                        />
                      </td>
                    </>
                  )}
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
