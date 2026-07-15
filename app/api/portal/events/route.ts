/**
 * POST { event, props? } → logs one in-portal behavioural event for the
 * signed-in customer (portal_events, keyed by session email). Fire-and-
 * forget from the client (sendBeacon / keepalive fetch). Allowlisted
 * event names so the table stays clean.
 */

import { NextRequest, NextResponse } from "next/server";

import { getPortalSession } from "@/lib/portal/session";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const ALLOWED_EVENTS = new Set([
  "portal_open",
  "tab_view",
  "join_click",
  "join_start",
  "vehicle_add",
  "change_request",
  "reminder_add",
  "photo_view",
]);

export async function POST(req: NextRequest) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  let body: { event?: string; props?: Record<string, unknown> };
  try {
    // sendBeacon posts a Blob; text()+parse handles both it and fetch.
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const event = (body.event ?? "").slice(0, 40);
  if (!ALLOWED_EVENTS.has(event)) return NextResponse.json({ ok: false }, { status: 400 });

  // Keep props small + safe: use as-is if it serialises under the cap,
  // else drop it (never truncate JSON - that corrupts it).
  let props: Record<string, unknown> = {};
  if (body.props && typeof body.props === "object" && !Array.isArray(body.props)) {
    try {
      if (JSON.stringify(body.props).length <= 500) props = body.props;
    } catch {
      props = {};
    }
  }

  try {
    await getSupabaseAdminClient()
      .from("portal_events")
      .insert({ email: session.email, event, props });
  } catch {
    /* non-fatal - analytics must never break the portal */
  }
  return NextResponse.json({ ok: true });
}
