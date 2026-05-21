/**
 * Data layer for the /sales view (cold-lead caller queue).
 *
 * Returns "callable" leads — created in a stale-but-not-dead window, not
 * already won or lost, and without a booking on file. Ordered by
 * least-recently-touched so a rep doesn't double-call someone they just
 * spoke to.
 *
 * IMPORTANT: shop scope is always pinned to the caller-provided shopId,
 * NOT to the active-shop cookie. The /sales page resolves shopId from
 * the sales user's assigned_shop_id (or admin's current shop).
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type SalesRange = "7-30d" | "30-90d" | "90-180d" | "all";

export type SalesLeadEntry = {
  leadId: string;
  contactId: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  vehicleLabel: string | null;
  serviceRequested: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  daysSinceEnquiry: number;
  lastTouchedAt: string;
};

export type SalesQueueResult = {
  entries: SalesLeadEntry[];
  bucketCounts: { "7-30d": number; "30-90d": number; "90-180d": number; all: number };
  totalShown: number;
};

const CLOSED_STATUSES = ["won", "lost"];

function rangeBounds(range: SalesRange): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now);
  const to = new Date(now);
  switch (range) {
    case "7-30d":
      from.setDate(now.getDate() - 30);
      to.setDate(now.getDate() - 7);
      break;
    case "30-90d":
      from.setDate(now.getDate() - 90);
      to.setDate(now.getDate() - 30);
      break;
    case "90-180d":
      from.setDate(now.getDate() - 180);
      to.setDate(now.getDate() - 90);
      break;
    case "all":
    default:
      from.setDate(now.getDate() - 180);
      to.setDate(now.getDate() - 7);
      break;
  }
  return { from, to };
}

export async function getSalesQueue(args: {
  shopId: string;
  range?: SalesRange;
  service?: string;
  untouchedOnly?: boolean;
}): Promise<SalesQueueResult> {
  const supabase = getSupabaseAdminClient();
  const range = args.range ?? "all";
  const { from, to } = rangeBounds(range);

  let q = supabase
    .from("leads")
    .select(
      "id, shop_id, contact_id, vehicle_id, service_requested, status, created_at, updated_at, " +
        "contact:contacts(id, first_name, last_name, full_name, email, phone), " +
        "vehicle:vehicles(year, make, model, size)"
    )
    .eq("shop_id", args.shopId)
    .not("archived", "eq", true)
    .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .order("updated_at", { ascending: true })
    .limit(500);

  if (args.service) {
    q = q.ilike("service_requested", `%${args.service}%`);
  }

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    contact_id: string | null;
    service_requested: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    contact: {
      id: string;
      first_name: string | null;
      last_name: string | null;
      full_name: string | null;
      email: string | null;
      phone: string | null;
    } | null;
    vehicle: { year: string | null; make: string | null; model: string | null; size: string | null } | null;
  }>;

  // Filter out leads that already have a booking (one-call close means we
  // only call people who haven't booked yet). One round-trip for all
  // candidate contact IDs is cheaper than a join.
  const contactIds = Array.from(new Set(rows.map((r) => r.contact_id).filter(Boolean) as string[]));
  const bookedContactIds = new Set<string>();
  if (contactIds.length > 0) {
    const { data: bookingRows } = await supabase
      .from("bookings")
      .select("contact_id")
      .eq("shop_id", args.shopId)
      .in("contact_id", contactIds)
      .not("status", "in", "(cancelled,no_show)");
    for (const b of (bookingRows ?? []) as Array<{ contact_id: string | null }>) {
      if (b.contact_id) bookedContactIds.add(b.contact_id);
    }
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const entries: SalesLeadEntry[] = rows
    .filter((r) => r.contact && !bookedContactIds.has(r.contact_id as string))
    .map((r) => {
      const c = r.contact!;
      const v = r.vehicle;
      const name = c.full_name ?? ([c.first_name, c.last_name].filter(Boolean).join(" ") || null);
      const vehicleLabel = v && (v.year || v.make || v.model)
        ? [v.year, v.make, v.model, v.size].filter(Boolean).join(" ")
        : null;
      const daysSince = Math.floor((now - new Date(r.created_at).getTime()) / dayMs);
      return {
        leadId: r.id,
        contactId: c.id,
        contactName: name,
        email: c.email,
        phone: c.phone,
        vehicleLabel,
        serviceRequested: r.service_requested,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        daysSinceEnquiry: daysSince,
        lastTouchedAt: r.updated_at,
      };
    });

  // Untouched filter: no team note OR no team email in the last 14 days.
  // Approximation — we use the lead.updated_at as a proxy for last team
  // activity. It bumps on note edits, status changes, and email sends.
  let filtered = entries;
  if (args.untouchedOnly) {
    const cutoff = now - 14 * dayMs;
    filtered = entries.filter((e) => new Date(e.updatedAt).getTime() < cutoff);
  }

  const bucketCounts = await getBucketCounts(args.shopId, args.service);

  return {
    entries: filtered,
    bucketCounts,
    totalShown: filtered.length,
  };
}

async function getBucketCounts(shopId: string, service?: string): Promise<SalesQueueResult["bucketCounts"]> {
  // Cheap parallel count queries for the four range buckets. We don't
  // bother filtering out already-booked contacts here — the headline
  // count is enquiry volume, not exact callable count, and the actual
  // list page does the precise filter.
  const supabase = getSupabaseAdminClient();
  async function count(range: SalesRange) {
    const { from, to } = rangeBounds(range);
    let q = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .not("archived", "eq", true)
      .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString());
    if (service) q = q.ilike("service_requested", `%${service}%`);
    const { count: c } = await q;
    return c ?? 0;
  }
  const [a, b, c, d] = await Promise.all([
    count("7-30d"),
    count("30-90d"),
    count("90-180d"),
    count("all"),
  ]);
  return { "7-30d": a, "30-90d": b, "90-180d": c, all: d };
}
