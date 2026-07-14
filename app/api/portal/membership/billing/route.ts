/**
 * POST (portal session-authed) → { url } for Stripe's hosted billing
 * portal - card updates + cancellation self-service for active members.
 */

import { NextResponse } from "next/server";

import { getMemberships } from "@/lib/portal/membership";
import { getPortalContacts, getPortalSession } from "@/lib/portal/session";
import { createBillingPortalSession } from "@/lib/portal/stripe";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function POST() {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const contacts = await getPortalContacts(session.email);
  const memberships = await getMemberships(contacts.map((c) => c.id));
  const member = memberships.find((m) => m.status === "active" || m.status === "past_due");
  if (!member) return NextResponse.json({ error: "No active membership" }, { status: 404 });

  const supabase = getSupabaseAdminClient();
  const { data: row } = await supabase
    .from("memberships")
    .select("stripe_customer_id")
    .eq("id", member.id)
    .single();
  if (!row?.stripe_customer_id) {
    return NextResponse.json({ error: "Billing not set up yet - contact us to make changes" }, { status: 400 });
  }

  try {
    const url = await createBillingPortalSession(row.stripe_customer_id);
    if (!url) throw new Error("no url");
    return NextResponse.json({ url });
  } catch (err) {
    console.error("billing portal session failed", err);
    return NextResponse.json({ error: "Couldn't open billing settings - try again shortly" }, { status: 500 });
  }
}
