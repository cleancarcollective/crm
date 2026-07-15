/**
 * Supabase-backed cache of LLM-resolved (and staff-overridden) vehicle
 * sizes. Sits between the hardcoded MODEL_DB and the LLM call so we only
 * pay for Claude once per (make, model) pair. The table is also a
 * growing, free, shop-tuned vehicle DB — see migration
 * docs/migrations/2026-05-28-vehicle-size-lookups-cache.sql.
 *
 * Lookup + write are isolated to this module so the rest of the
 * auto-respond pipeline doesn't have to know about the schema.
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { normalizeMake, normalizeModel, type VehicleSize } from "./vehicleSizing";

export type CachedVehicleSize = {
  size: VehicleSize;
  confidence: number;
  source: "llm" | "staff_override";
  rationale: string | null;
};

/**
 * Look up a previously resolved size for this (make, model). Returns
 * null on miss or when the table is unreachable (non-fatal — caller
 * falls through to the LLM path).
 *
 * Also bumps hit_count + last_hit_at on every hit so we can see which
 * vehicles are most frequently asked about.
 */
/** Same model classed the same size across close years - a 2022 and a
 *  2025 Corolla share a cache row. But cars can jump size class across a
 *  generation, so a request whose year is more than this many years from
 *  the cached year is treated as a miss and re-resolved via the LLM. */
const YEAR_STALE_THRESHOLD = 4;

export async function lookupVehicleSizeFromCache(
  makeRaw: string,
  modelRaw: string,
  yearRaw?: string | number | null,
): Promise<CachedVehicleSize | null> {
  const make = normalizeMake(makeRaw);
  const model = normalizeModel(modelRaw);
  if (!make || !model) return null;

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("vehicle_size_lookups")
      .select("size, confidence, source, rationale, hit_count, year_resolved")
      .eq("make_normalized", make)
      .eq("model_normalized", model)
      .maybeSingle();

    if (error || !data) return null;

    // Staff overrides are trusted regardless of year. For LLM-cached rows,
    // if the requested year is far from the year we resolved for, treat it
    // as a miss so the caller re-checks (the car may have changed size).
    const reqYear = Number(yearRaw);
    if (
      data.source !== "staff_override" &&
      Number.isFinite(reqYear) &&
      reqYear > 1980 &&
      typeof data.year_resolved === "number" &&
      Math.abs(reqYear - data.year_resolved) > YEAR_STALE_THRESHOLD
    ) {
      return null;
    }

    // Bump hit count. Non-blocking — the trigger handles updated_at /
    // last_hit_at on every update.
    void supabase
      .from("vehicle_size_lookups")
      .update({ hit_count: (data.hit_count ?? 1) + 1 })
      .eq("make_normalized", make)
      .eq("model_normalized", model)
      .then(({ error: bumpErr }) => {
        if (bumpErr) console.warn("vehicle_size_lookups hit-count bump failed (non-fatal)", bumpErr.message);
      });

    return {
      size: data.size as VehicleSize,
      confidence: Number(data.confidence) || 0,
      source: data.source as "llm" | "staff_override",
      rationale: data.rationale ?? null,
    };
  } catch (err) {
    console.warn("lookupVehicleSizeFromCache failed (non-fatal)", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Persist a freshly-resolved size. Upserts on the (make, model) PK so
 * repeated calls don't duplicate rows; an existing row's hit_count is
 * left alone (the bump on lookup handles that). We DO NOT overwrite a
 * staff_override with an LLM verdict — staff has the final say.
 */
export async function recordVehicleSizeToCache(args: {
  makeRaw: string;
  modelRaw: string;
  size: VehicleSize;
  confidence: number;
  source: "llm" | "staff_override";
  rationale?: string | null;
  yearResolved?: string | number | null;
}): Promise<void> {
  const make = normalizeMake(args.makeRaw);
  const model = normalizeModel(args.modelRaw);
  if (!make || !model) return;

  try {
    const supabase = getSupabaseAdminClient();

    // Check existing first — if a staff_override exists and we're an
    // LLM write, leave it alone.
    if (args.source === "llm") {
      const { data: existing } = await supabase
        .from("vehicle_size_lookups")
        .select("source")
        .eq("make_normalized", make)
        .eq("model_normalized", model)
        .maybeSingle();
      if (existing?.source === "staff_override") return;
    }

    const yr = Number(args.yearResolved);
    const yearResolved = Number.isFinite(yr) && yr > 1980 ? Math.round(yr) : null;

    const { error } = await supabase
      .from("vehicle_size_lookups")
      .upsert(
        {
          make_normalized: make,
          model_normalized: model,
          size: args.size,
          confidence: Math.max(0, Math.min(1, args.confidence)),
          source: args.source,
          rationale: args.rationale ?? null,
          year_resolved: yearResolved,
        },
        { onConflict: "make_normalized,model_normalized" },
      );
    if (error) {
      console.warn("recordVehicleSizeToCache upsert failed (non-fatal)", error.message);
    }
  } catch (err) {
    console.warn("recordVehicleSizeToCache failed (non-fatal)", err instanceof Error ? err.message : err);
  }
}
