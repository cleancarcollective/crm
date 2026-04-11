import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { parseImportFile } from "@/lib/import/parseImportFile";

const DEFAULT_SHOP_SLUG = "christchurch";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const rows = await parseImportFile(buffer, file.name);

  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("slug", DEFAULT_SHOP_SLUG).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  let imported = 0;

  for (const row of rows) {
    const name = String(row["Name"] || row["full_name"] || "").trim();
    const email = String(row["Email"] || row["email"] || "").trim().toLowerCase();
    const phone = String(row["Phone"] || row["phone"] || "").trim();
    const service = String(row["Service"] || row["service_requested"] || "").trim();
    const notes = String(row["Notes"] || row["notes"] || "").trim();

    if (!email && !name) continue;

    // Upsert contact
    let contactId: string;
    if (email) {
      const { data: existing } = await supabase.from("contacts").select("id").eq("shop_id", shop.id).eq("email", email).maybeSingle();
      if (existing) {
        contactId = existing.id;
      } else {
        const parts = name.split(" ");
        const { data: newContact } = await supabase.from("contacts").insert({
          shop_id: shop.id,
          email,
          phone: phone || null,
          first_name: parts[0] || name,
          last_name: parts.slice(1).join(" ") || null,
          full_name: name || null,
        }).select("id").single();
        if (!newContact) continue;
        contactId = newContact.id;
      }
    } else continue;

    // Create lead
    await supabase.from("leads").insert({
      shop_id: shop.id,
      contact_id: contactId,
      service_requested: service || null,
      notes: notes || null,
      source: "import",
      status: String(row["Status"] || row["status"] || "new").toLowerCase(),
      won_source: String(row["Won Via"] || row["won_source"] || "").trim() || null,
    });

    imported++;
  }

  return NextResponse.json({ imported });
}
