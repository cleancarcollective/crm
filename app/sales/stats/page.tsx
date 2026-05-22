import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { requireRoleIn } from "@/lib/auth/roles";
import { formatCurrency } from "@/lib/dashboard/format";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const RANGE_DAYS: Record<string, number> = { "30": 30, "60": 60, "90": 90 };

type SalesUserRow = {
  userId: string;
  name: string;
  email: string;
  calls: number;
  won: number;
  bookings: number;
  revenue: number;
};

type ServiceRow = {
  serviceName: string;
  count: number;
  revenue: number;
};

type FunnelRow = {
  worked: number;
  booked: number;
  conversionPct: number;
};

export default async function SalesStatsPage({
  searchParams,
}: {
  searchParams?: Promise<{ range?: string }>;
}) {
  const user = requireRoleIn(await getCurrentUser(), ["admin"]);
  const shop = user.shop;

  const params = (await searchParams) ?? {};
  const rangeRaw = (params.range ?? "30").trim();
  const days = RANGE_DAYS[rangeRaw] ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const supabase = getSupabaseAdminClient();

  // ── 1. Pull every sales user for this shop. We surface even those with
  //       zero activity so the manager can see "rep X did nothing this
  //       window" at a glance.
  const { data: salesUsers } = await supabase
    .from("staff_users")
    .select("id, name, email, role, assigned_shop_id, shop_id")
    .eq("role", "sales");

  const salesUsersForShop = (salesUsers ?? []).filter((u) => {
    const assigned = u.assigned_shop_id as string | null;
    const home = u.shop_id as string;
    return (assigned ?? home) === shop.id;
  });

  // ── 2. Per-user calls (distinct lead_ids with a note in window).
  const { data: noteRows } = await supabase
    .from("lead_notes_log")
    .select("user_id, lead_id, created_at")
    .eq("shop_id", shop.id)
    .gte("created_at", since);

  const callsByUser = new Map<string, Set<string>>();
  const callTimesByUserLead = new Map<string, string>(); // `${userId}|${leadId}` -> earliest createdAt
  for (const row of noteRows ?? []) {
    const uid = (row.user_id as string | null) ?? "";
    if (!uid) continue;
    const lid = row.lead_id as string;
    if (!callsByUser.has(uid)) callsByUser.set(uid, new Set());
    callsByUser.get(uid)!.add(lid);
    const key = `${uid}|${lid}`;
    const existing = callTimesByUserLead.get(key);
    const t = row.created_at as string;
    if (!existing || t < existing) callTimesByUserLead.set(key, t);
  }

  // ── 3. Per-user wins (leads with won_source='sales_call' in window).
  //       We attribute the win to whoever has the most recent note on the
  //       lead within the window - that's our best proxy for "who closed
  //       it" since leads.won_source doesn't carry a user_id.
  const { data: wonLeads } = await supabase
    .from("leads")
    .select("id, booked_at")
    .eq("shop_id", shop.id)
    .eq("won_source", "sales_call")
    .gte("booked_at", since);

  const wonByUser = new Map<string, number>();
  if (wonLeads && wonLeads.length > 0) {
    const ids = wonLeads.map((l) => l.id as string);
    const { data: lastNoteRows } = await supabase
      .from("lead_notes_log")
      .select("lead_id, user_id, created_at")
      .in("lead_id", ids)
      .order("created_at", { ascending: false });
    const closerByLead = new Map<string, string>();
    for (const r of lastNoteRows ?? []) {
      const lid = r.lead_id as string;
      const uid = r.user_id as string | null;
      if (!uid) continue;
      if (!closerByLead.has(lid)) closerByLead.set(lid, uid);
    }
    for (const uid of closerByLead.values()) {
      wonByUser.set(uid, (wonByUser.get(uid) ?? 0) + 1);
    }
  }

  // ── 4. Per-user bookings + revenue via bookings.booked_by_user_id.
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, booked_by_user_id, price_estimate, service_name, created_at")
    .eq("shop_id", shop.id)
    .gte("created_at", since)
    .not("booked_by_user_id", "is", null);

  const bookingCountByUser = new Map<string, number>();
  const revenueByUser = new Map<string, number>();
  const serviceTotals = new Map<string, { count: number; revenue: number }>();
  const salesUserIds = new Set(salesUsersForShop.map((u) => u.id as string));
  for (const b of bookings ?? []) {
    const uid = b.booked_by_user_id as string | null;
    if (!uid) continue;
    bookingCountByUser.set(uid, (bookingCountByUser.get(uid) ?? 0) + 1);
    const price = (b.price_estimate as number | null) ?? 0;
    revenueByUser.set(uid, (revenueByUser.get(uid) ?? 0) + price);
    if (salesUserIds.has(uid)) {
      const name = (b.service_name as string | null) ?? "(unknown)";
      const cur = serviceTotals.get(name) ?? { count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += price;
      serviceTotals.set(name, cur);
    }
  }

  const userRows: SalesUserRow[] = salesUsersForShop.map((u) => {
    const uid = u.id as string;
    return {
      userId: uid,
      name: (u.name as string) ?? "",
      email: (u.email as string) ?? "",
      calls: callsByUser.get(uid)?.size ?? 0,
      won: wonByUser.get(uid) ?? 0,
      bookings: bookingCountByUser.get(uid) ?? 0,
      revenue: revenueByUser.get(uid) ?? 0,
    };
  });
  userRows.sort((a, b) => b.revenue - a.revenue);

  const services: ServiceRow[] = Array.from(serviceTotals.entries())
    .map(([serviceName, v]) => ({ serviceName, count: v.count, revenue: v.revenue }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // ── 5. Funnel: leads worked vs leads booked within 14d of any sales note.
  const workedLeadIds = new Set<string>();
  for (const r of noteRows ?? []) {
    const uid = (r.user_id as string | null) ?? "";
    if (uid && salesUserIds.has(uid)) {
      workedLeadIds.add(r.lead_id as string);
    }
  }
  let bookedFromWorked = 0;
  if (workedLeadIds.size > 0) {
    const ids = Array.from(workedLeadIds);
    const { data: workedLeads } = await supabase
      .from("leads")
      .select("id, contact_id, booked_at")
      .in("id", ids);
    for (const l of workedLeads ?? []) {
      const lid = l.id as string;
      const bookedAt = l.booked_at as string | null;
      if (!bookedAt) continue;
      // Find earliest sales note for this lead.
      let earliest: string | null = null;
      for (const r of noteRows ?? []) {
        const uid = (r.user_id as string | null) ?? "";
        if ((r.lead_id as string) !== lid) continue;
        if (!salesUserIds.has(uid)) continue;
        const t = r.created_at as string;
        if (!earliest || t < earliest) earliest = t;
      }
      if (!earliest) continue;
      const diffMs = new Date(bookedAt).getTime() - new Date(earliest).getTime();
      const within14d = diffMs >= 0 && diffMs <= 14 * 24 * 60 * 60 * 1000;
      if (within14d) bookedFromWorked += 1;
    }
  }
  const funnel: FunnelRow = {
    worked: workedLeadIds.size,
    booked: bookedFromWorked,
    conversionPct:
      workedLeadIds.size === 0 ? 0 : Math.round((bookedFromWorked / workedLeadIds.size) * 1000) / 10,
  };

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Sales attribution</p>
          <h1 className="pageTitle">Sales stats</h1>
          <p className="detailSubtitle">{shop.name} · last {days} days</p>
        </div>
        <div className="topbarMeta">
          <Link href="/sales" className="textLink">Back to sales queue</Link>
        </div>
      </div>

      <form className="directoryFilterBar" method="get" action="/sales/stats">
        <label className="modalField">
          <span>Range</span>
          <select className="detailInput" name="range" defaultValue={String(days)}>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
        <button type="submit" className="buttonPrimary">Apply</button>
      </form>

      <section className="detailPanel">
        <h2>Per sales user</h2>
        {userRows.length === 0 ? (
          <p className="profileEmpty">No sales users assigned to this shop.</p>
        ) : (
          <table className="staffTable">
            <thead>
              <tr>
                <th>Sales user</th>
                <th>Calls (notes left)</th>
                <th>Won</th>
                <th>Bookings created</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {userRows.map((r) => (
                <tr key={r.userId}>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <strong>{r.name || "(unnamed)"}</strong>
                      <span style={{ fontSize: 12, color: "#9e9189" }}>{r.email}</span>
                    </div>
                  </td>
                  <td>{r.calls}</td>
                  <td>{r.won}</td>
                  <td>{r.bookings}</td>
                  <td>{formatCurrency(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="detailPanel">
        <h2>Top services booked by sales</h2>
        {services.length === 0 ? (
          <p className="profileEmpty">No sales bookings in this window.</p>
        ) : (
          <table className="staffTable">
            <thead>
              <tr>
                <th>Service</th>
                <th>Bookings</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.serviceName}>
                  <td>{s.serviceName}</td>
                  <td>{s.count}</td>
                  <td>{formatCurrency(s.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="detailPanel">
        <h2>Conversion funnel</h2>
        <table className="staffTable">
          <thead>
            <tr>
              <th>Cold leads worked (called)</th>
              <th>Leads booked within 14d</th>
              <th>Conversion %</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{funnel.worked}</td>
              <td>{funnel.booked}</td>
              <td>{funnel.conversionPct}%</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
