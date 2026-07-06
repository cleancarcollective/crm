/**
 * Meta Conversions API upload — feeds real booking outcomes back to the
 * Meta pixel/dataset so Ads Manager shows revenue per campaign and the
 * delivery system learns which form-fillers turn into paying bookings.
 *
 * Website leads have no Meta-generated lead_id (that's an Instant Forms
 * concept), so matching rides on SHA256-hashed email + phone, which Meta
 * ranks Highest/High priority for CRM events.
 *
 * Idempotency: event_id = booking id. Meta dedupes identical
 * (event_name, event_id) pairs, so overlapping upload windows are safe.
 *
 * Env: META_CAPI_ACCESS_TOKEN (dataset access token, Vercel env only).
 */

import { createHash } from "node:crypto";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const DATASET_ID = "1231414185076940";
const API_VERSION = "v25.0";

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

function hashEmail(email: string | null): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e ? sha256(e) : null;
}

/** NZ-normalise then hash: digits only, leading 0 -> 64 country code. */
function hashPhone(phone: string | null): string | null {
  let d = (phone ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0")) d = "64" + d.slice(1);
  return sha256(d);
}

type CapiEvent = {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: string;
  custom_data: Record<string, unknown>;
  user_data: Record<string, unknown>;
};

export async function uploadRecentBookingsToMeta(opts: {
  windowDays: number;
  testEventCode?: string | null;
}): Promise<{ ok: boolean; candidates: number; sent: number; skippedNoContact: number; fbtrace?: string; error?: string }> {
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!token) return { ok: false, candidates: 0, sent: 0, skippedNoContact: 0, error: "META_CAPI_ACCESS_TOKEN not set" };

  const supabase = getSupabaseAdminClient();
  const since = new Date(Date.now() - opts.windowDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, created_at, price_estimate, service_name, status, booking_source, contacts(email, phone)")
    .gte("created_at", since)
    .neq("status", "cancelled");
  if (error) return { ok: false, candidates: 0, sent: 0, skippedNoContact: 0, error: error.message };

  const events: CapiEvent[] = [];
  let skippedNoContact = 0;

  for (const b of bookings ?? []) {
    const contact = b.contacts as unknown as { email: string | null; phone: string | null } | null;
    const em = hashEmail(contact?.email ?? null);
    const ph = hashPhone(contact?.phone ?? null);
    if (!em && !ph) {
      skippedNoContact++;
      continue;
    }
    const userData: Record<string, unknown> = {};
    if (em) userData.em = [em];
    if (ph) userData.ph = [ph];

    events.push({
      event_name: "Purchase",
      event_time: Math.floor(Date.parse(b.created_at as string) / 1000),
      event_id: b.id as string,
      action_source: "system_generated",
      custom_data: {
        currency: "NZD",
        value: Number(b.price_estimate ?? 0),
        event_source: "crm",
        lead_event_source: "CCC CRM",
        content_name: (b.service_name as string) ?? "Booking",
        booking_source: (b.booking_source as string) ?? "unknown",
      },
      user_data: userData,
    });
  }

  if (events.length === 0) {
    return { ok: true, candidates: (bookings ?? []).length, sent: 0, skippedNoContact };
  }

  const body: Record<string, unknown> = { data: events };
  if (opts.testEventCode) body.test_event_code = opts.testEventCode;

  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${DATASET_ID}/events?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const json = (await res.json()) as { events_received?: number; fbtrace_id?: string; error?: { message?: string } };

  if (!res.ok || json.error) {
    return {
      ok: false,
      candidates: (bookings ?? []).length,
      sent: 0,
      skippedNoContact,
      fbtrace: json.fbtrace_id,
      error: json.error?.message ?? `HTTP ${res.status}`,
    };
  }

  return {
    ok: true,
    candidates: (bookings ?? []).length,
    sent: json.events_received ?? events.length,
    skippedNoContact,
    fbtrace: json.fbtrace_id,
  };
}
