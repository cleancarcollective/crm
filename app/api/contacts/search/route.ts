import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (q.length < 2) {
    return NextResponse.json({ contacts: [] });
  }

  const shop = await requireCurrentShop();
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

  // Also match by vehicle rego / make / model ("ABC123", "Hilux") and
  // fold those owners into the result set.
  if ((contacts?.length ?? 0) < 8) {
    const { data: regoVehicles } = await supabase
      .from("vehicles")
      .select("contact_id")
      .eq("shop_id", shop.id)
      .or(`rego.ilike.%${q}%,make.ilike.%${q}%,model.ilike.%${q}%`)
      .not("contact_id", "is", null)
      .limit(8);
    const extraIds = [...new Set((regoVehicles ?? []).map((v) => v.contact_id))]
      .filter((id) => !(contacts ?? []).some((c) => c.id === id))
      .slice(0, 8 - (contacts?.length ?? 0));
    if (extraIds.length > 0) {
      const { data: extraContacts } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, full_name, email, phone")
        .eq("shop_id", shop.id)
        .in("id", extraIds);
      contacts?.push(...(extraContacts ?? []));
    }
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
