/**
 * /giveaway  (admin): entries for the Wellington Oct 2026 giveaway, live
 * count, referral stats, and the Draw winners button. Replaces the Google
 * Sheet the page was originally going to write into.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { GIVEAWAY, REFERRAL, parseEntryTag, referralCounts, ticketsFor, type EntryTag } from "@/lib/giveaway/wlgOct2026";
import { GiveawayDrawButton } from "@/components/dashboard/GiveawayDrawButton";
import { TOUCHES, sentTouches } from "@/lib/giveaway/drip";

export const metadata = { title: "Giveaway - CCC CRM" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  created_at: string;
  internal_notes: string | null;
  contacts: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  vehicles: { year: string | null; make: string | null; model: string | null } | null;
};
type Entry = Row & { tag: EntryTag };

const th = { padding: "6px 8px" } as const;
const td = { padding: "8px" } as const;
const prizeRank = (p?: string) => (!p ? 9 : p.startsWith("GRAND PRIZE -") ? 0 : p.startsWith("GRAND PRIZE (") ? 1 : p.startsWith("Second") ? 2 : 3);

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
  const rows = all.filter((r): r is Entry => !!r.tag && !r.tag.test);
  const counts = referralCounts(rows);
  const byCode = new Map<string, Entry>();
  for (const r of rows) if (r.tag.code) byCode.set(r.tag.code, r);
  const tickets = (r: Entry) => ticketsFor(r.tag, counts);
  const referrals = (r: Entry) => (r.tag.code ? counts.get(r.tag.code) ?? 0 : 0);
  const referredBy = (r: Entry) => (r.tag.ref ? byCode.get(r.tag.ref) ?? null : null);
  const nameLink = (r: Entry | null) =>
    !r ? null : r.contacts?.id ? <Link href={`/contacts/${r.contacts.id}`} className="profileNameLink">{r.contacts.full_name}</Link> : r.contacts?.full_name;

  const winners = rows.filter((r) => r.tag.prize).sort((a, b) => prizeRank(a.tag.prize) - prizeRank(b.tag.prize));
  const referred = rows.filter((r) => r.tag.ref).length;
  const ticketsTotal = rows.reduce((sum, r) => sum + tickets(r), 0);
  const topReferrers = rows.filter((r) => referrals(r) > 0).sort((a, b) => referrals(b) - referrals(a)).slice(0, 10);
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
          <div className="quickFactCard"><div className="quickFactValue">{referred}</div><div className="quickFactLabel">Came through a share link</div></div>
          <div className="quickFactCard"><div className="quickFactValue">{ticketsTotal}</div><div className="quickFactLabel">Tickets in the draw</div></div>
          <div className="quickFactCard"><div className="quickFactValue">{winners.length}</div><div className="quickFactLabel">Winners drawn</div></div>
        </div>
        <p className="settingsDescription" style={{ marginTop: 12 }}>
          Each entry holds 1 ticket plus 1 per friend who entered through its share link (max {REFERRAL.maxExtraEntries} extra).
          If the grand prize winner came in through a link, the referrer wins a grand prize too.
        </p>
      </section>

      <section className="detailPanel analyticsSection">
        <h2>Countdown messages</h2>
        <p className="settingsDescription">Email (Postmark broadcast, unsubscribe link) + SMS (TNZ, opt-outs honoured). Each entrant gets each touch once; "sent" counts entrants marked for that touch.</p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, maxWidth: 720 }}>
          <thead><tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>
            <th style={{ padding: "6px 8px 6px 0" }}>Touch</th><th style={th}>Sends (NZ)</th><th style={th}>Channels</th><th style={th}>Status</th><th style={th}>Sent</th>
          </tr></thead>
          <tbody>
            {TOUCHES.map((t) => (
              <tr key={t.key} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "8px 8px 8px 0" }}>{t.note}</td>
                <td style={td}>{t.sendAt.toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td style={td}>{[t.email ? "email" : null, t.sms ? "SMS" : null].filter(Boolean).join(" + ")}</td>
                <td style={td}>{t.enabled ? "on" : "off"}</td>
                <td style={td}>{rows.filter((r) => sentTouches(r.internal_notes).has(t.key)).length} / {rows.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {winners.length > 0 ? (
        <section className="detailPanel analyticsSection">
          <h2>Winners</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>
                <th style={{ padding: "6px 8px 6px 0" }}>Prize</th><th style={th}>Name</th><th style={th}>Contact</th><th style={th}>Vehicle</th><th style={th}>Tickets</th><th style={th}>Referred by</th>
              </tr></thead>
              <tbody>
                {winners.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "10px 8px 10px 0", fontWeight: 700 }}>{r.tag.prize}</td>
                    <td style={{ padding: "10px 8px" }}>{nameLink(r)}</td>
                    <td style={{ padding: "10px 8px", color: "var(--muted)" }}>{r.contacts?.email}<br />{r.contacts?.phone}</td>
                    <td style={{ padding: "10px 8px" }}>{[r.vehicles?.year, r.vehicles?.make, r.vehicles?.model].filter(Boolean).join(" ")}</td>
                    <td style={{ padding: "10px 8px" }}>{r.tag.tickets ?? tickets(r)}</td>
                    <td style={{ padding: "10px 8px" }}>{nameLink(referredBy(r)) ?? <span style={{ color: "var(--muted)" }}>Direct</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {topReferrers.length > 0 ? (
        <section className="detailPanel analyticsSection">
          <h2>Top referrers</h2>
          <p className="settingsDescription">Worth a shout-out on socials mid-campaign: it pulls more sharing.</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, maxWidth: 560 }}>
            <thead><tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>
              <th style={{ padding: "6px 8px 6px 0" }}>Name</th><th style={th}>Friends entered</th><th style={th}>Tickets</th>
            </tr></thead>
            <tbody>
              {topReferrers.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 8px 8px 0" }}>{nameLink(r)}</td>
                  <td style={td}>{referrals(r)}</td>
                  <td style={td}>{tickets(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="detailPanel analyticsSection">
        <h2>All entries</h2>
        <p className="settingsDescription">Newest first. Each entrant is a contact, so you can quote or book them after the draw.</p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 980 }}>
            <thead><tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>
              <th style={{ padding: "6px 8px 6px 0" }}>Entered</th><th style={th}>Name</th><th style={th}>Email</th><th style={th}>Mobile</th><th style={th}>Vehicle</th><th style={th}>Referred by</th><th style={th}>Referrals</th><th style={th}>Tickets</th><th style={th}>Code</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 12, color: "var(--muted)" }}>No entries yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 8px 8px 0", whiteSpace: "nowrap" }}>{fmt(r.created_at)}</td>
                  <td style={td}>{nameLink(r)}</td>
                  <td style={{ ...td, color: "var(--muted)" }}>{r.contacts?.email}</td>
                  <td style={{ ...td, color: "var(--muted)" }}>{r.contacts?.phone}</td>
                  <td style={td}>{[r.vehicles?.year, r.vehicles?.make, r.vehicles?.model].filter(Boolean).join(" ")}</td>
                  <td style={td}>{nameLink(referredBy(r)) ?? <span style={{ color: "var(--muted)" }}>Direct</span>}</td>
                  <td style={td}>{referrals(r)}</td>
                  <td style={td}>{tickets(r)}</td>
                  <td style={{ ...td, fontFamily: "monospace", color: "var(--muted)" }}>{r.tag.code ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
