import Link from "next/link";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { TEMPLATE_KEY_LABELS } from "@/lib/autorespond/templateDefaults";
import type { TemplateKey } from "@/lib/autorespond/templates";
import { TemplatesSeedButton } from "@/components/dashboard/TemplatesSeedButton";

const DEFAULT_SHOP_SLUG = "christchurch";

type Perf = {
  sent: number;
  opened: number;
  clicked: number;
  won: number;
  lost: number;
  needs_approval: number;
};

export default async function TemplatesIndexPage() {
  const supabase = getSupabaseAdminClient();

  const { data: shop } = await supabase
    .from("shops")
    .select("id, name")
    .eq("slug", DEFAULT_SHOP_SLUG)
    .maybeSingle();

  if (!shop) return <main className="pageShell"><p>Shop not found.</p></main>;

  const { data: templates } = await supabase
    .from("lead_email_templates")
    .select("id, template_key, variant, name, subject, is_active, updated_at")
    .eq("shop_id", shop.id)
    .order("template_key")
    .order("variant");

  // 30-day performance per template_id — now backed by the engagement
  // denorm columns populated by the Postmark webhook. A lead counts as
  // "sent" if any downstream status was reached (sent/clicked/won/lost).
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: statRows } = await supabase
    .from("leads")
    .select("template_id, status, email_opened_at, email_clicked_at")
    .eq("shop_id", shop.id)
    .not("template_id", "is", null)
    .gte("created_at", thirtyDaysAgo);

  const perf: Record<string, Perf> = {};
  for (const row of statRows ?? []) {
    const id = row.template_id as string | null;
    if (!id) continue;
    if (!perf[id]) perf[id] = { sent: 0, opened: 0, clicked: 0, won: 0, lost: 0, needs_approval: 0 };

    if (row.status === "sent" || row.status === "clicked" || row.status === "won" || row.status === "lost") {
      perf[id].sent += 1;
    }
    if (row.email_opened_at) perf[id].opened += 1;
    if (row.email_clicked_at) perf[id].clicked += 1;
    if (row.status === "won") perf[id].won += 1;
    if (row.status === "lost") perf[id].lost += 1;
    if (row.status === "needs_approval") perf[id].needs_approval += 1;
  }

  const rows = templates ?? [];
  const isEmpty = rows.length === 0;

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">
            <Link href="/settings" className="eyebrowLink">← Back to Settings</Link>
          </p>
          <h1 className="pageTitle">Email templates</h1>
          <p className="detailSubtitle">{shop.name}</p>
        </div>
      </div>

      <section className="detailPanel settingsSection">
        <h2>Estimate templates</h2>
        <p className="settingsDescription">
          These are the auto-respond estimate emails sent when a new lead comes in.
          Edit subject lines and body copy here — changes apply immediately to new leads.
          Performance stats show the last 30 days.
          <br />
          <span className="settingsDescriptionMuted">
            * Open and click tracking are currently OFF so estimate emails land in
            Primary inbox (not Promotions). Conversion rate (sent → won) is the
            reliable signal — trust that. To re-enable open/click tracking without
            the deliverability hit, set up a custom Postmark link-tracking domain
            (e.g. links.cleancarcollective.co.nz) — ask Claude to walk you through it.
          </span>
        </p>

        {isEmpty ? (
          <div className="templatesEmptyState">
            <p>No templates yet. Seed defaults to get started.</p>
            <TemplatesSeedButton />
          </div>
        ) : (
          <div className="templatesList">
            {rows.map((t) => {
              const p: Perf = perf[t.id] ?? { sent: 0, opened: 0, clicked: 0, won: 0, lost: 0, needs_approval: 0 };
              const conv = p.sent > 0 ? Math.round((p.won / p.sent) * 100) : 0;
              const ctr = p.sent > 0 ? Math.round((p.clicked / p.sent) * 100) : 0;
              const openRate = p.sent > 0 ? Math.round((p.opened / p.sent) * 100) : 0;
              return (
                <Link key={t.id} href={`/settings/templates/${t.id}`} className="templateCard">
                  <div className="templateCardHeader">
                    <div>
                      <div className="templateCardKey">
                        {TEMPLATE_KEY_LABELS[t.template_key as TemplateKey] ?? t.template_key}
                        {t.variant !== "A" ? <span className="templateVariantChip"> Variant {t.variant}</span> : null}
                        {!t.is_active ? <span className="templateInactiveChip">Paused</span> : null}
                      </div>
                      <div className="templateCardName">{t.name}</div>
                    </div>
                    <span className="templateCardChevron">→</span>
                  </div>
                  <div className="templateCardSubject">{t.subject}</div>
                  <div className="templateCardStats">
                    <div className="templateStat">
                      <span className="templateStatValue">{p.sent}</span>
                      <span className="templateStatLabel">sent</span>
                    </div>
                    <div className="templateStat" title="Open rate is inflated by Apple Mail Privacy Protection — treat as a weak signal">
                      <span className="templateStatValue">{openRate}%</span>
                      <span className="templateStatLabel">opened* ({p.opened})</span>
                    </div>
                    <div className="templateStat">
                      <span className="templateStatValue">{ctr}%</span>
                      <span className="templateStatLabel">clicked ({p.clicked})</span>
                    </div>
                    <div className="templateStat">
                      <span className="templateStatValue">{conv}%</span>
                      <span className="templateStatLabel">won ({p.won})</span>
                    </div>
                    <div className="templateStat">
                      <span className="templateStatValue">{p.needs_approval}</span>
                      <span className="templateStatLabel">needs approval</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
