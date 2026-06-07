/**
 * Data layer for the /sales view.
 *
 * Buckets a lead lives in EXACTLY ONE of:
 *   warm     — inbound TODAY (NZ-local). Today's queue.
 *   cold     — 1-14 days old. The "callable" middle window.
 *   frozen   — >14 days old. Older / forgotten leads.
 *   cooldown — manually flagged with cooldown_until > now(). Takes priority
 *              over all age-based buckets.
 *
 * "Callable" leads in any bucket exclude: archived, status in won/lost,
 * and contacts who already have a booking on file. Cool-down rows additionally
 * carry the reason + resurface date so the rep sees context without clicking in.
 *
 * Shop scope is always pinned to the caller-provided shopId, NOT the
 * active-shop cookie. /sales resolves shopId from the sales user's
 * assigned_shop_id (or admin's current shop).
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type SalesRange = "7-30d" | "30-90d" | "90-180d" | "all";

export type SalesBucket = "warm" | "cold" | "frozen" | "cooldown";

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
  cooldownUntil: string | null;
  cooldownReason: string | null;
  lastDisposition: string | null;
};

export type SalesBucketCounts = {
  warm: number;
  cold: number;
  frozen: number;
  cooldown: number;
};

/**
 * Category = disposition chip the rep last picked, plus a synthetic
 * "untouched" (never actioned) and "all". Drives the overview strip above
 * the lead list on each bucket page.
 */
export type SalesCategory =
  | "all"
  | "untouched"
  | "neutral"
  | "positive"
  | "confirmed"
  | "malfunction"
  | "lost"
  | "booked";

export type SalesCategoryCounts = Record<SalesCategory, number>;

export type SalesQueueResult = {
  entries: SalesLeadEntry[];
  bucketCounts: SalesBucketCounts;
  categoryCounts: SalesCategoryCounts;
  rangeCounts: { "7-30d": number; "30-90d": number; "90-180d": number; all: number; orbis: number };
  totalShown: number;
};

function categoryOf(entry: SalesLeadEntry): Exclude<SalesCategory, "all"> {
  const d = entry.lastDisposition;
  if (d === "neutral" || d === "positive" || d === "confirmed" || d === "malfunction" || d === "lost" || d === "booked") {
    return d;
  }
  // No disposition picked yet → untouched (rep hasn't actioned this lead).
  return "untouched";
}

const CLOSED_STATUSES = ["won", "lost"];

/**
 * Most-recent local midnight in Pacific/Auckland, returned as a UTC Date.
 * Handles both NZST (+12) and NZDT (+13) without depending on the host TZ.
 */
function nzStartOfTodayUtc(): Date {
  const todayYmd = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
  const tryStd = new Date(`${todayYmd}T00:00:00+12:00`);
  if (tryStd.toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }) === todayYmd) return tryStd;
  return new Date(`${todayYmd}T00:00:00+13:00`);
}

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
  bucket?: SalesBucket;
  category?: SalesCategory;
  range?: SalesRange;
  service?: string;
  untouchedOnly?: boolean;
  /** Admin CSV export: use the legacy range-bounded query, ignore buckets. */
  rangeQuery?: boolean;
  /**
   * "Active" mode (default) is the daily caller workflow: leads from the
   * website 7-180 days old, not yet won/lost. "Orbis" mode surfaces
   * historical OrbisX-imported leads regardless of status - 3.5k cold
   * prospects + 1k previous customers to re-engage. "All" is both.
   */
  mode?: "active" | "orbis" | "all";
}): Promise<SalesQueueResult> {
  const supabase = getSupabaseAdminClient();
  const bucket = args.bucket ?? "cold";
  const range = args.range ?? "all";
  const mode = args.mode ?? "active";
  const nowIso = new Date().toISOString();

  let q = supabase
    .from("leads")
    .select(
      "id, shop_id, contact_id, vehicle_id, service_requested, status, source, created_at, updated_at, " +
        "cooldown_until, cooldown_reason, last_disposition, " +
        "contact:contacts(id, first_name, last_name, full_name, email, phone), " +
        "vehicle:vehicles(year, make, model, size)"
    )
    .eq("shop_id", args.shopId)
    .not("archived", "eq", true)
    .order("updated_at", { ascending: true })
    .limit(500);

  // Bucket gates — applied in addition to mode/source filters.
  if (args.rangeQuery) {
    // Legacy range-based query (used by the admin CSV export). Preserves the
    // pre-bucketing behaviour: 7-180d window via rangeBounds(range), not
    // won/lost, website source. Ignores the warm/cold/frozen split.
    const { from, to } = rangeBounds(range);
    q = q
      .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
      .neq("source", "orbis-import")
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString());
  } else if (bucket === "cooldown") {
    // Active cool-downs (resurface date in the future). No date-range
    // filter — show all cool-downs regardless of lead age.
    q = q.gt("cooldown_until", nowIso);
  } else {
    // For non-cool-down buckets, exclude any lead currently in cool-down.
    q = q.or(`cooldown_until.is.null,cooldown_until.lte.${nowIso}`);

    const nzMidnight = nzStartOfTodayUtc();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    if (bucket === "warm") {
      // Inbound today (NZ-local). Active workflow only — orbis mode doesn't
      // apply to "today's leads" (orbis is historical by definition).
      q = q
        .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
        .neq("source", "orbis-import")
        .gte("created_at", nzMidnight.toISOString());
    } else if (bucket === "frozen") {
      // Older than 14 days, not won/lost, still active queue (orbis stays
      // on its own page-of-record via the existing mode filter on /sales).
      if (mode === "orbis") {
        q = q.eq("source", "orbis-import").lt("created_at", fourteenDaysAgo.toISOString());
      } else {
        q = q
          .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
          .neq("source", "orbis-import")
          .lt("created_at", fourteenDaysAgo.toISOString());
      }
    } else {
      // bucket === "cold": 1-14 days old, ≥1d old so we don't double-count
      // warm. Honour the mode + range filters (existing UI semantics).
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (mode === "active") {
        q = q
          .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
          .neq("source", "orbis-import")
          .lt("created_at", oneDayAgo.toISOString())
          .gte("created_at", fourteenDaysAgo.toISOString());
      } else if (mode === "orbis") {
        q = q.eq("source", "orbis-import");
      } else {
        // "all" — orbis OR (active cold-window)
        q = q.or(
          `source.eq.orbis-import,and(status.not.in.(${CLOSED_STATUSES.join(",")}),created_at.gte.${fourteenDaysAgo.toISOString()},created_at.lt.${oneDayAgo.toISOString()}))`,
        );
      }
    }
  }

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
    cooldown_until: string | null;
    cooldown_reason: string | null;
    last_disposition: string | null;
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

  // Exclude contacts that already have a booking. One round-trip is cheaper
  // than a join. Note: we DO show booked contacts on the cooldown bucket
  // too — if a rep flagged someone who later booked elsewhere, they should
  // still see why they were flagged.
  const contactIds = Array.from(new Set(rows.map((r) => r.contact_id).filter(Boolean) as string[]));
  const bookedContactIds = new Set<string>();
  if (contactIds.length > 0 && bucket !== "cooldown") {
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
        cooldownUntil: r.cooldown_until,
        cooldownReason: r.cooldown_reason,
        lastDisposition: r.last_disposition,
      };
    });

  // Untouched-only filter (cold bucket UI). Approximation — uses updated_at
  // as a proxy for last team activity.
  let filtered = entries;
  if (args.untouchedOnly && bucket === "cold") {
    const cutoff = now - 14 * dayMs;
    filtered = entries.filter((e) => new Date(e.updatedAt).getTime() < cutoff);
  }

  // Category counts are derived from the bucket's entries (post booked-contact
  // exclusion, post untouched-filter) so the overview strip matches the list.
  const categoryCounts: SalesCategoryCounts = {
    all: filtered.length,
    untouched: 0,
    neutral: 0,
    positive: 0,
    confirmed: 0,
    malfunction: 0,
    lost: 0,
    booked: 0,
  };
  for (const e of filtered) {
    categoryCounts[categoryOf(e)] += 1;
  }

  // Apply the category filter LAST so the counts above reflect the whole
  // bucket, but the list only shows the chosen category.
  const category = args.category ?? "all";
  if (category !== "all") {
    filtered = filtered.filter((e) => categoryOf(e) === category);
  }

  const [bucketCounts, rangeCounts] = await Promise.all([
    getBucketCounts(args.shopId, args.service),
    getRangeCounts(args.shopId, args.service),
  ]);

  return {
    entries: filtered,
    bucketCounts,
    categoryCounts,
    rangeCounts,
    totalShown: filtered.length,
  };
}

/**
 * Counts for the 4 bucket tabs (warm/cold/frozen/cooldown). Counts apply the
 * service filter but do NOT subtract booked-contacts (the badges are headline
 * volume, not exact callable — the actual list page does the precise filter).
 */
async function getBucketCounts(shopId: string, service?: string): Promise<SalesBucketCounts> {
  const supabase = getSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const nzMidnight = nzStartOfTodayUtc();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  function base() {
    let q = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .not("archived", "eq", true);
    if (service) q = q.ilike("service_requested", `%${service}%`);
    return q;
  }
  function notCooldown<T extends ReturnType<typeof base>>(q: T): T {
    return q.or(`cooldown_until.is.null,cooldown_until.lte.${nowIso}`) as T;
  }
  function activeNotClosed<T extends ReturnType<typeof base>>(q: T): T {
    return q.not("status", "in", `(${CLOSED_STATUSES.join(",")})`).neq("source", "orbis-import") as T;
  }

  const [{ count: warm }, { count: cold }, { count: frozen }, { count: cooldown }] = await Promise.all([
    activeNotClosed(notCooldown(base())).gte("created_at", nzMidnight.toISOString()),
    activeNotClosed(notCooldown(base())).gte("created_at", fourteenDaysAgo.toISOString()).lt("created_at", oneDayAgo.toISOString()),
    activeNotClosed(notCooldown(base())).lt("created_at", fourteenDaysAgo.toISOString()),
    base().gt("cooldown_until", nowIso),
  ]);

  return {
    warm: warm ?? 0,
    cold: cold ?? 0,
    frozen: frozen ?? 0,
    cooldown: cooldown ?? 0,
  };
}

/**
 * Range bucket counts used by the existing /sales mode-switcher cards
 * (Recent enquiries / OrbisX / Everything). Preserved so the existing UI
 * keeps working alongside the new bucket tabs.
 */
async function getRangeCounts(shopId: string, service?: string): Promise<SalesQueueResult["rangeCounts"]> {
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
  async function countOrbis() {
    let q = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .not("archived", "eq", true)
      .eq("source", "orbis-import");
    if (service) q = q.ilike("service_requested", `%${service}%`);
    const { count: c } = await q;
    return c ?? 0;
  }
  const [a, b, c, d, o] = await Promise.all([
    count("7-30d"),
    count("30-90d"),
    count("90-180d"),
    count("all"),
    countOrbis(),
  ]);
  return { "7-30d": a, "30-90d": b, "90-180d": c, all: d, orbis: o };
}
