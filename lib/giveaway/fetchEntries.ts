/**
 * Loads every lead row for the current giveaway, paging past PostgREST's
 * 1,000-row response cap. A plain .limit(5000) is silently clamped to 1,000
 * by the server, which hid entries from the admin page, the countdown drip
 * and the draw once the giveaway passed 1,000 entries.
 */

import type { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { GIVEAWAY } from "@/lib/giveaway/wlgOct2026";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdminClient>;

const PAGE_SIZE = 1000;

export async function fetchAllGiveawayLeads<T>(supabase: SupabaseAdmin, shopId: string, columns: string): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("leads")
      .select(columns)
      .eq("shop_id", shopId)
      .eq("source", GIVEAWAY.leadSource)
      .ilike("internal_notes", `%[giveaway:${GIVEAWAY.key}]%`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as unknown as T[];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return all;
}
