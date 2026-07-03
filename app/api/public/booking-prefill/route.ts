import { NextResponse } from "next/server";

import { verifyActionToken } from "@/lib/auth/signedTokens";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

/**
 * POST /api/public/booking-prefill
 *
 * Token-authed. The instant-quote deep-link carries a short-lived
 * `booking_prefill` token (minted by the leads intake when it returns a
 * quote). The booking form exchanges it here for the customer's contact +
 * vehicle details so they don't retype what they just entered on the
 * estimate form.
 *
 * PII never travels in the URL — only the opaque signed token does, and it
 * expires in ~2h. We return the minimum the booking form needs to prefill.
 */

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: Request) {
  let token: string | undefined;
  try {
    token = ((await request.json()) as { token?: string }).token;
  } catch {
    return withCors(NextResponse.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!token) {
    return withCors(NextResponse.json({ error: "Missing token" }, { status: 400 }));
  }

  const verified = await verifyActionToken(token, { requireAction: "booking_prefill" });
  if (!verified.ok) {
    return withCors(NextResponse.json({ error: verified.reason }, { status: 401 }));
  }

  const leadId = verified.payload.r;
  const supabase = getSupabaseAdminClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("contact_id, vehicle_id")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) {
    return withCors(NextResponse.json({ error: "not_found" }, { status: 404 }));
  }

  const [{ data: contact }, { data: vehicle }] = await Promise.all([
    lead.contact_id
      ? supabase
          .from("contacts")
          .select("first_name, last_name, email, phone")
          .eq("id", lead.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    lead.vehicle_id
      ? supabase
          .from("vehicles")
          .select("year, make, model")
          .eq("id", lead.vehicle_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return withCors(
    NextResponse.json({
      first_name: contact?.first_name ?? null,
      last_name: contact?.last_name ?? null,
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
      vehicle_year: vehicle?.year != null ? String(vehicle.year) : null,
      vehicle_make: vehicle?.make ?? null,
      vehicle_model: vehicle?.model ?? null,
    })
  );
}
