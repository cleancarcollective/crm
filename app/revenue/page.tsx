/**
 * /revenue  (admin): day-by-day revenue across both shops, side by side,
 * with week and month subtotals. "Booked" is every confirmed or completed
 * booking scheduled that day; "Done" is the completed ones only. Amounts
 * are booking price estimates, ex-GST, bucketed by the shop's local
 * calendar day. Cancelled bookings are excluded everywhere.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { fetchAllRows } from "@/lib/export/fetchAllRows";
import { formatCurrency } from "@/lib/dashboard/format";

export const metadata = { title: "Revenue - CCC CRM" };
export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number> = { "7": 7, "30": 30, "90": 90 };
const TZ = "Pacific/Auckland";
const SHOP_ORDER = ["wellington", "christchurch"];

type Shop = { id: string; slug: string; name: string; timezone: string | null };
type BookingRow = { id: string; shop_id: string; status: string; price_estimate: number | null; scheduled_start: string };
type Cell = { booked: number; done: number; jobs: number; doneJobs: number };
const emptyCell = (): Cell => ({ booked: 0, done: 0, jobs: 0, doneJobs: 0 });
const add = (a: Cell, b: Cell): Cell => ({ booked: a.booked + b.booked, done: a.done + b.done, jobs: a.jobs + b.jobs, doneJobs: a.doneJobs + b.doneJobs });

/** yyyy-MM-dd -> Date at UTC midnight (only used for weekday / arithmetic on the label). */
const toUtc = (day: string) => new Date(`${day}T00:00:00Z`);
const dayKeyOffset = (day: string, offset: number) => toUtc(day).getTime() + offset * 86400000 > 0 ? new Date(toUtc(day).getTime() + offset * 86400000).toISOString().slice(0, 10) : day;
/** Monday that starts the ISO week containing `day`. */
const weekStart = (day: string) => { const d = toUtc(day); const dow = (d.getUTCDay() + 6) % 7; return dayKeyOffset(day, -dow); };
const fmtDay = (day: string) => toUtc(day).toLocaleDateString("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const fmtMonth = (key: string) => toUtc(`${key}-01`).toLocaleDateString("en-NZ", { timeZone: "UTC", month: "long", year: "numeric" });
const money = (n: number) => formatCurrency(n, { withGstLabel: false });

export default async function RevenuePage({ searchParams }: { searchParams?: Promise<{ range?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <main className="pageShell">
        <div className="pageTopbar"><div><h1 className="pageTitle">Revenue</h1><p className="detailSubtitle">{user.shop.name}</p></div></div>
        <section className="detailPanel"><p>The revenue view is admin-only.</p></section>
      </main>
    );
  }

  const params = (await searchParams) ?? {};
  const days = RANGE_DAYS[(params.range ?? "30").trim()] ?? 30;
  const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
  const dayKeys: string[] = Array.from({ length: days }, (_, i) => dayKeyOffset(today, -i)); // newest first
  const firstDay = dayKeys[dayKeys.length - 1];
  const inWindow = new Set(dayKeys);

  const supabase = getSupabaseAdminClient();
  const { data: shopRows } = await supabase.from("shops").select("id, slug, name, timezone").in("slug", SHOP_ORDER);
  const shops: Shop[] = SHOP_ORDER.map((slug) => (shopRows ?? []).find((s) => s.slug === slug)).filter((s): s is Shop => !!s);

  // Query a day wider on each side in UTC, then bucket by the NZ calendar day.
  const bookings = await fetchAllRows<BookingRow>((from, to) =>
    supabase
      .from("bookings")
      .select("id, shop_id, status, price_estimate, scheduled_start")
      .in("shop_id", shops.map((s) => s.id))
      .in("status", ["confirmed", "completed"])
      .gte("scheduled_start", `${dayKeyOffset(firstDay, -1)}T00:00:00Z`)
      .lte("scheduled_start", `${dayKeyOffset(today, 1)}T23:59:59Z`)
      .order("scheduled_start", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );

  // day -> shopId -> cell
  const byDay = new Map<string, Map<string, Cell>>();
  let unpriced = 0;
  for (const b of bookings) {
    const day = formatInTimeZone(new Date(b.scheduled_start), TZ, "yyyy-MM-dd");
    if (!inWindow.has(day)) continue;
    const price = b.price_estimate ?? 0;
    if (b.price_estimate === null) unpriced++;
    const shopMap = byDay.get(day) ?? new Map<string, Cell>();
    const cell = shopMap.get(b.shop_id) ?? emptyCell();
    cell.booked += price; cell.jobs += 1;
    if (b.status === "completed") { cell.done += price; cell.doneJobs += 1; }
    shopMap.set(b.shop_id, cell); byDay.set(day, shopMap);
  }
  const cellFor = (day: string, shopId: string) => byDay.get(day)?.get(shopId) ?? emptyCell();
  const totalFor = (day: string) => shops.reduce((acc, s) => add(acc, cellFor(day, s.id)), emptyCell());

  // Week and month rollups (keys newest first, same order as the days).
  const rollup = (keyOf: (day: string) => string) => {
    const keys: string[] = []; const sums = new Map<string, Map<string, Cell>>();
    for (const day of dayKeys) {
      const k = keyOf(day); if (!sums.has(k)) { keys.push(k); sums.set(k, new Map()); }
      const m = sums.get(k)!;
      for (const s of shops) m.set(s.id, add(m.get(s.id) ?? emptyCell(), cellFor(day, s.id)));
    }
    return keys.map((k) => ({ key: k, cells: shops.map((s) => sums.get(k)!.get(s.id) ?? emptyCell()), total: shops.reduce((acc, s) => add(acc, sums.get(k)!.get(s.id) ?? emptyCell()), emptyCell()), dayCount: dayKeys.filter((d) => keyOf(d) === k).length }));
  };
  const weeks = rollup(weekStart);
  const months = rollup((d) => d.slice(0, 7));
  const windowTotals = shops.map((s) => dayKeys.reduce((acc, d) => add(acc, cellFor(d, s.id)), emptyCell()));
  const grand = windowTotals.reduce((acc, c) => add(acc, c), emptyCell());

  const th = { textAlign: "right" as const, whiteSpace: "nowrap" as const };
  const num = { textAlign: "right" as const, fontVariantNumeric: "tabular-nums" as const, whiteSpace: "nowrap" as const };
  const short = (s: Shop) => (s.slug === "wellington" ? "WLG" : s.slug === "christchurch" ? "CHC" : s.name);
  const head = (label: string) => (
    <tr>
      <th>{label}</th>
      {shops.map((s) => (<th key={s.id + "b"} style={th}>{short(s)} booked</th>))}
      {shops.map((s) => (<th key={s.id + "d"} style={th}>{short(s)} done</th>))}
      <th style={th}>Total booked</th><th style={th}>Total done</th><th style={th}>Jobs</th>
    </tr>
  );
  const cells = (row: Cell[], total: Cell, strong = false) => (
    <>
      {row.map((c, i) => (<td key={"b" + i} style={num}>{c.booked ? money(c.booked) : <span style={{ color: "var(--muted)" }}>-</span>}</td>))}
      {row.map((c, i) => (<td key={"d" + i} style={num}>{c.done ? money(c.done) : <span style={{ color: "var(--muted)" }}>-</span>}</td>))}
      <td style={{ ...num, fontWeight: strong ? 700 : 600 }}>{total.booked ? money(total.booked) : "-"}</td>
      <td style={{ ...num, fontWeight: strong ? 700 : 600 }}>{total.done ? money(total.done) : "-"}</td>
      <td style={num}>{total.jobs}{total.doneJobs ? <span style={{ color: "var(--muted)" }}> ({total.doneJobs} done)</span> : null}</td>
    </>
  );

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Both shops</p>
          <h1 className="pageTitle">Revenue by day</h1>
          <p className="detailSubtitle">Wellington and Christchurch, last {days} days to {fmtDay(today)}. Booking estimates, ex-GST, by the day the job is scheduled.</p>
        </div>
        <div className="topbarMeta"><Link href="/analytics" className="textLink">Funnel and trends</Link></div>
      </div>

      <form className="directoryFilterBar" method="get" action="/revenue">
        <label className="modalField">
          <span>Range</span>
          <select className="detailInput" name="range" defaultValue={String(days)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
        <button type="submit" className="buttonPrimary">Apply</button>
      </form>

      <section className="detailPanel analyticsSection">
        <div className="quickFactsGrid">
          <div className="quickFactCard"><div className="quickFactValue">{money(grand.booked)}</div><div className="quickFactLabel">Booked, both shops</div></div>
          <div className="quickFactCard"><div className="quickFactValue">{money(grand.done)}</div><div className="quickFactLabel">Completed, both shops</div></div>
          {shops.map((s, i) => (
            <div className="quickFactCard" key={s.id}><div className="quickFactValue">{money(windowTotals[i].booked)}</div><div className="quickFactLabel">{short(s)} booked ({windowTotals[i].jobs} jobs)</div></div>
          ))}
          <div className="quickFactCard"><div className="quickFactValue">{money(days ? grand.booked / days : 0)}</div><div className="quickFactLabel">Average per day, booked</div></div>
        </div>
        <p className="settingsDescription" style={{ marginTop: 12 }}>
          Booked = confirmed plus completed bookings scheduled on that day. Done = completed only. Cancelled bookings are excluded. Future days in the window show what is already on the calendar.
          {unpriced ? ` ${unpriced} booking${unpriced === 1 ? "" : "s"} in this window ${unpriced === 1 ? "has" : "have"} no price estimate and count as $0.` : ""}
        </p>
      </section>

      {months.length > 1 ? (
        <section className="detailPanel analyticsSection">
          <h2>By month</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="staffTable" style={{ minWidth: 760 }}>
              <thead>{head("Month")}</thead>
              <tbody>{months.map((m) => (<tr key={m.key}><td>{fmtMonth(m.key)}<span style={{ color: "var(--muted)" }}> · {m.dayCount} days in range</span></td>{cells(m.cells, m.total, true)}</tr>))}</tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="detailPanel analyticsSection">
        <h2>By week</h2>
        <p className="settingsDescription">Weeks start Monday. The newest week is usually partial.</p>
        <div style={{ overflowX: "auto" }}>
          <table className="staffTable" style={{ minWidth: 760 }}>
            <thead>{head("Week starting")}</thead>
            <tbody>{weeks.map((w) => (<tr key={w.key}><td>{fmtDay(w.key)}{w.dayCount < 7 ? <span style={{ color: "var(--muted)" }}> · {w.dayCount} days</span> : null}</td>{cells(w.cells, w.total, true)}</tr>))}</tbody>
          </table>
        </div>
      </section>

      <section className="detailPanel analyticsSection">
        <h2>By day</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="staffTable" style={{ minWidth: 760 }}>
            <thead>{head("Day")}</thead>
            <tbody>
              {dayKeys.map((d) => {
                const t = totalFor(d); const isToday = d === today; const weekend = [0, 6].includes(toUtc(d).getUTCDay());
                return (
                  <tr key={d} style={{ background: isToday ? "var(--surface-raised, rgba(0,0,0,0.04))" : undefined, opacity: weekend && t.jobs === 0 ? 0.6 : 1 }}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDay(d)}{isToday ? <span style={{ color: "var(--muted)" }}> · today</span> : null}</td>
                    {cells(shops.map((s) => cellFor(d, s.id)), t)}
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr style={{ borderTop: "2px solid var(--line)" }}><td><strong>Last {days} days</strong></td>{cells(windowTotals, grand, true)}</tr></tfoot>
          </table>
        </div>
      </section>
    </main>
  );
}
