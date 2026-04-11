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

    if (!email && !name) continue;

    if (email) {
      const { data: existing } = await supabase.from("contacts").select("id").eq("shop_id", shop.id).eq("email", email).maybeSingle();
      if (existing) {
        // Update phone/name if blank
        await supabase.from("contacts").update({ ...(phone ? { phone } : {}), full_name: name || undefined }).eq("id", existing.id);
      } else {
        const parts = name.split(" ");
        await supabase.from("contacts").insert({
          shop_id: shop.id,
          email,
          phone: phone || null,
          first_name: parts[0] || name,
          last_name: parts.slice(1).join(" ") || null,
          full_name: name || null,
        });
        imported++;
      }
    }
  }

  return NextResponse.json({ imported });
}
