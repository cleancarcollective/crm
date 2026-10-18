/**
 * /giveaway  (admin): entries for the Wellington Oct 2026 giveaway, live
 * count, and the Draw winners button. Replaces the Google Sheet the page
 * was originally going to write into.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { GIVEAWAY, parseEntryTag } from "@/lib/giveaway/wlgOct2026";
import { GiveawayDrawButton } from "@/components/dashboard/GiveawayDrawButton";

export const metadata = { title: "Giveaway - CCC CRM" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  created_at: string;
  internal_notes: string | null;
  contacts: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  vehicles: { year: string | null; make: string | null; model: string | null } | null;
};

export default async function GiveawayPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from("leads")
    .select("id, created_at, internal_notes, contacts(id, full_name, email, phone), vehicles(year, make, model)")
    .eq("shop_id", user.shop.id)
    .eq("source", GIVEAWAY.leadSource)
    .ilike("internal_notes", `%[giveaway:${GIVEAWAY.key}]%`)
    .order("created_at", { ascending: false })
    .limit(5000);

  const all = ((data ?? []) as unknown as Row[]).map((r) => ({ ...r, tag: parseEntryTag(r.internal_notes) }));
  const rows = all.filter((r) => r.tag && !r.tag.test);
  const winners = rows.filter((r) => r.tag?.prize);
  const now = Date.now();
  const state = now < GIVEAWAY.opens.getTime() ? "Not open yet" : now > GIVEAWAY.closes.getTime() ? "Closed" : "Open";
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Wellington</p>
          <h1 className="pageTitle">October giveaway</h1>
          <p className="detailSubtitle">
            Entries {GIVEAWAY.opens.toLocaleDateString("en-NZ", { day: "numeric", month: "short" })} to{" "}
            {GIVEAWAY.closes.toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}. Status: <strong>{state}</strong>.
          </p>
        </div>
        {user.role === "admin" ? <GiveawayDrawButton alreadyDrawn={winners.length > 0} /> : null}
      </div>

      <section className="detailPanel analyticsSection">
        <div className="quickFactsGrid">
          <div className="quickFactCard"><div className="quickFactValue">{rows.length}</div><div className="quickFactLabel">Entries</div></div>
          <div className="quickFactCard"><div className="quickFactValue">{winners.length}</div><div className="quickFactLabel">Winners drawn</div></div>
        </div>
      </section>

      {winners.length > 0 ? (
        <section className="detailPanel analyticsSection">
          <h2>Winners</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>
                <th style={{ padding: "6px 8px 6px 0" }}>Prize</th><th style={{ padding: "6px 8px" }}>Name</th><th style={{ padding: "6px 8px" }}>Contact</th><th style={{ padding: "6px 8px" }}>Vehicle</th>
              </tr></thead>
              <tbody>
                {winners
                  .sort((a, b) => String(a.tag?.prize).localeCompare(String(b.tag?.prize)))
                  .map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ padding: "10px 8px 10px 0", fontWeight: 700 }}>{r.tag?.prize}</td>
                      <td style={{ padding: "10px 8px" }}>{r.contacts?.id ? <Link href={`/contacts/${r.contacts.id}`} className="profileNameLink">{r.contacts.full_name}</Link> : r.contacts?.full_name}</td>
                      <td style={{ padding: "10px 8px", color: "var(--muted)" }}>{r.contacts?.email}<br />{r.contacts?.phone}</td>
                      <td style={{ padding: "10px 8px" }}>{[r.vehicles?.year, r.vehicles?.make, r.vehicles?.model].filter(Boolean).join(" ")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="detailPanel analyticsSection">
        <h2>All entries</h2>
        <p className="settingsDescription">Newest first. Each entrant is a contact, so you can quote or book them after the draw.</p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
            <thead><tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>
              <th style={{ padding: "6px 8px 6px 0" }}>Entered</th><th style={{ padding: "6px 8px" }}>Name</th><th style={{ padding: "6px 8px" }}>Email</th><th style={{ padding: "6px 8px" }}>Mobile</th><th style={{ padding: "6px 8px" }}>Vehicle</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 12, color: "var(--muted)" }}>No entries yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 8px 8px 0", whiteSpace: "nowrap" }}>{fmt(r.created_at)}</td>
                  <td style={{ padding: "8px" }}>{r.contacts?.id ? <Link href={`/contacts/${r.contacts.id}`} className="profileNameLink">{r.contacts.full_name}</Link> : r.contacts?.full_name}</td>
                  <td style={{ padding: "8px", color: "var(--muted)" }}>{r.contacts?.email}</td>
                  <td style={{ padding: "8px", color: "var(--muted)" }}>{r.contacts?.phone}</td>
                  <td style={{ padding: "8px" }}>{[r.vehicles?.year, r.vehicles?.make, r.vehicles?.model].filter(Boolean).join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
