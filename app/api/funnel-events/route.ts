import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

/**
 * Booking-funnel drop-off beacons.
 *
 * The booking apps (main form + ceramic/interior ad funnels, all served from a
 * different origin) post one lightweight event per step as the customer moves
 * through: started -> schedule -> addons -> review -> booked. Grouped by a
 * client-generated session_id so we can measure where people drop off, and
 * stamped with booking_id on the final "booked" step so the funnel joins
 * straight to the real booking.
 *
 * Called via navigator.sendBeacon (text/plain body, response unreadable), so we
 * parse defensively and always 204 fast. CORS is open — cross-origin iframe.
 */

const ALLOWED_STEPS = new Set(["started", "service", "schedule", "addons", "review", "booked"]);
const ALLOWED_FUNNELS = new Set(["main", "ceramic", "interior"]);

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

type FunnelEventBody = {
  session_id?: string;
  shop_slug?: string;
  funnel?: string;
  step?: string;
  booking_id?: string | null;
  meta?: Record<string, unknown>;
  landing_url?: string;
};

export async function POST(request: Request) {
  let body: FunnelEventBody;
  try {
    body = (await request.json()) as FunnelEventBody;
  } catch {
    try {
      body = JSON.parse(await request.text()) as FunnelEventBody;
    } catch {
      return withCors(new NextResponse(null, { status: 204 }));
    }
  }

  const step = typeof body.step === "string" ? body.step : "";
  const sessionId = typeof body.session_id === "string" ? body.session_id.slice(0, 100) : "";
  const shopSlug = typeof body.shop_slug === "string" ? body.shop_slug.slice(0, 40) : "";
  const funnel = ALLOWED_FUNNELS.has(body.funnel as string) ? (body.funnel as string) : "main";

  // Fire-and-forget instrumentation — never 4xx a beacon the client can't read.
  if (!ALLOWED_STEPS.has(step) || !sessionId || !shopSlug) {
    return withCors(new NextResponse(null, { status: 204 }));
  }

  try {
    const supabase = getSupabaseAdminClient();
    await supabase.from("funnel_events").insert({
      session_id: sessionId,
      shop_slug: shopSlug,
      funnel,
      step,
      booking_id: typeof body.booking_id === "string" ? body.booking_id : null,
      meta: body.meta && typeof body.meta === "object" ? body.meta : null,
      landing_url: typeof body.landing_url === "string" ? body.landing_url.slice(0, 500) : null,
    });
  } catch (err) {
    console.error("funnel-event insert failed", err);
  }

  return withCors(new NextResponse(null, { status: 204 }));
}
