/**
 * System health page — surfaces silent failures across crons, queues,
 * webhooks, and external integrations.
 *
 * Server-rendered, no cache. Refresh the page for fresh data.
 *
 * Each check returns one of:
 *   - ok        → green
 *   - warn      → amber (degraded but not broken)
 *   - error     → red (immediate attention)
 *   - info      → grey (just an FYI)
 *
 * Keep adding checks here as new pieces of the system come online.
 */

import Link from "next/link";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { runChecks, type Check, type CheckStatus } from "@/lib/health/checks";


export default async function HealthPage() {
  const shop = await requireCurrentShop();

  const checks = await runChecks(shop.id);

  // Group by category
  const byCategory = new Map<string, Check[]>();
  for (const c of checks) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category)!.push(c);
  }

  const errors = checks.filter((c) => c.status === "error");
  const warns = checks.filter((c) => c.status === "warn");
  const ok = checks.filter((c) => c.status === "ok");

  const overall: CheckStatus =
    errors.length > 0 ? "error" : warns.length > 0 ? "warn" : "ok";

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">
            <Link href="/settings" className="eyebrowLink">← Back to Settings</Link>
          </p>
          <h1 className="pageTitle">System health</h1>
          <p className="detailSubtitle">
            {shop.name} · refreshed {new Date().toISOString().slice(0, 19)}Z
          </p>
        </div>
      </div>

      <section className="detailPanel settingsSection">
        <div className={`healthOverall healthOverall--${overall}`}>
          <div className="healthOverallLabel">
            {overall === "ok" && "All systems operational"}
            {overall === "warn" && "Degraded — investigate warnings"}
            {overall === "error" && "Critical issues detected"}
          </div>
          <div className="healthOverallCounts">
            <span className="healthCountChip healthCount--ok">{ok.length} OK</span>
            <span className="healthCountChip healthCount--warn">{warns.length} warn</span>
            <span className="healthCountChip healthCount--error">{errors.length} error</span>
          </div>
        </div>
      </section>

      {Array.from(byCategory.entries()).map(([category, items]) => (
        <section key={category} className="detailPanel settingsSection">
          <h2>{category}</h2>
          <div className="healthChecks">
            {items.map((c) => (
              <div key={c.name} className={`healthCheckRow healthCheckRow--${c.status}`}>
                <div className="healthCheckLight" data-status={c.status} />
                <div className="healthCheckBody">
                  <div className="healthCheckName">{c.name}</div>
                  <div className="healthCheckMessage">{c.message}</div>
                  {c.details ? (
                    <pre className="healthCheckDetails">{c.details}</pre>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <p className="analyticsFooterHint">
        Refresh this page to re-run all checks. Add new checks in{" "}
        <code>app/settings/health/page.tsx</code> as new system components come online.
      </p>
    </main>
  );
}
