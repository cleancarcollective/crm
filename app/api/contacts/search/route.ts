import { NextResponse } from "next/server";

import { getShopBySlug } from "@/lib/dashboard/bookings";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (q.length < 2) {
    return NextResponse.json({ contacts: [] });
  }

  const shop = await getShopBySlug();
  const supabase = getSupabaseAdminClient();

  // Search by full_name, email, or phone
  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, full_name, email, phone")
    .eq("shop_id", shop.id)
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
    .order("full_name", { ascending: true })
    .limit(8);

  if (error) {
    console.error("Contact search error", error);
    return NextResponse.json({ contacts: [] }, { status: 500 });
  }

  // For matched contacts, also fetch their vehicles
  const contactIds = (contacts ?? []).map((c) => c.id);
  let vehicles: { id: string; contact_id: string; make: string | null; model: string | null; year: string | null; rego: string | null; size: string | null }[] = [];

  if (contactIds.length > 0) {
    const { data: vData } = await supabase
      .from("vehicles")
      .select("id, contact_id, make, model, year, rego, size")
      .in("contact_id", contactIds)
      .eq("shop_id", shop.id);
    vehicles = vData ?? [];
  }

  const result = (contacts ?? []).map((c) => ({
    ...c,
    vehicles: vehicles.filter((v) => v.contact_id === c.id),
  }));

  return NextResponse.json({ contacts: result });
}
