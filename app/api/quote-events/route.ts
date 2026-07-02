import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

/**
 * Instant-quote funnel beacons (Layer 3).
 *
 * The quote screen (lead-form iframe) posts lightweight events here as the
 * customer interacts: quote_view, book_click, addon_click, contact_click.
 * Keyed by lead_id so it joins straight to the lead + booking funnel.
 *
 * Called via navigator.sendBeacon, which sends the body as text/plain and
 * cannot read the response — so we parse defensively and always 204 fast.
 * CORS is open because the lead form is served from a different origin.
 */

const ALLOWED_EVENTS = new Set([
  "quote_view",
  "book_click",
  "addon_click",
  "contact_click",
]);

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

type QuoteEventBody = {
  lead_id?: string;
  event?: string;
  meta?: Record<string, unknown>;
  shop_slug?: string;
};

export async function POST(request: Request) {
  let body: QuoteEventBody;
  try {
    // sendBeacon sends text/plain; request.json() still parses a JSON string body.
    body = (await request.json()) as QuoteEventBody;
  } catch {
    try {
      body = JSON.parse(await request.text()) as QuoteEventBody;
    } catch {
      return withCors(new NextResponse(null, { status: 204 }));
    }
  }

  const event = typeof body.event === "string" ? body.event : "";
  const leadId = typeof body.lead_id === "string" ? body.lead_id : null;

  // Silently no-op on junk — this is fire-and-forget instrumentation, never
  // worth 4xx-ing a beacon the client can't read anyway.
  if (!ALLOWED_EVENTS.has(event) || !leadId) {
    return withCors(new NextResponse(null, { status: 204 }));
  }

  try {
    const supabase = getSupabaseAdminClient();

    // Resolve shop_id from the lead so the event carries a shop without the
    // client having to be trusted for it.
    const { data: lead } = await supabase
      .from("leads")
      .select("shop_id")
      .eq("id", leadId)
      .maybeSingle();

    await supabase.from("quote_events").insert({
      lead_id: leadId,
      shop_id: lead?.shop_id ?? null,
      event,
      meta: body.meta && typeof body.meta === "object" ? body.meta : {},
    });
  } catch (err) {
    console.error("quote_events insert failed (non-fatal)", err);
  }

  return withCors(new NextResponse(null, { status: 204 }));
}
