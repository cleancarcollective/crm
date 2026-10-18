/**
 * POST /api/giveaway/enter
 *
 * Entry endpoint for the Wellington October 2026 giveaway landing page
 * (cleancarcollective.co.nz/giveaway). Replaces the Google Sheet + Apps
 * Script backend the page was originally written against, so every entrant
 * lands in the CRM as a contact + lead instead of a spreadsheet silo.
 *
 * Deliberately NOT routed through /api/leads/intake: that path sends the
 * team a "new lead" email, runs the vehicle-size LLM and auto-sends a
 * detailing estimate. None of that should happen for a giveaway entry.
 *
 * Mirrors the Apps Script rules it replaces:
 *   - entry window enforced server-side (NZ time)
 *   - honeypot field: bots get { ok: true } and nothing is saved
 *   - one entry per person, matched on normalised email OR mobile
 *     (gmail dots and +tags ignored, +64 / 0064 / 64 collapsed to 0)
 *   - formula-injection chars stripped so a CSV export can't execute
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { GIVEAWAY, clean, normaliseEmail, normaliseMobile, buildEntryTag, parseEntryTag } from "@/lib/giveaway/wlgOct2026";

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}
export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

const json = (body: Record<string, unknown>, status = 200) => withCors(NextResponse.json(body, { status }));


export async function POST(req: NextRequest) {
  let d: Record<string, unknown>;
  try {
    d = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid" }, 400);
  }

  // Honeypot: real people never see the "website" field.
  if (d.website) return json({ ok: true });

  const testMode = d.test === true || d.test === "true";
  const now = new Date();
  if (!testMode && (now < GIVEAWAY.opens || now > GIVEAWAY.closes)) {
    return json({ ok: false, error: "closed" });
  }

  const firstName = clean(d.firstName, 60);
  const lastName = clean(d.lastName, 60);
  const email = clean(d.email, 120);
  const mobile = clean(d.mobile, 20);
  const make = clean(d.make, 40);
  const model = clean(d.model, 40);
  const year = parseInt(String(d.year ?? ""), 10);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  const mobileKey = normaliseMobile(mobile);
  if (
    !firstName || !lastName || !make || !model || !emailOk ||
    mobileKey.length < 8 || !(year >= 1950 && year <= now.getFullYear() + 1)
  ) {
    return json({ ok: false, error: "invalid" });
  }
  const emailKey = normaliseEmail(email);

  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("slug", GIVEAWAY.shopSlug).maybeSingle();
  if (!shop) return json({ ok: false, error: "server" }, 500);

  // One entry per person. The normalised keys are stamped into
  // internal_notes (leads has no JSON column) so the duplicate check
  // doesn't depend on how the contact row was spelled.
  const { data: prior } = await supabase
    .from("leads")
    .select("id, internal_notes")
    .eq("shop_id", shop.id)
    .eq("source", GIVEAWAY.leadSource)
    .ilike("internal_notes", `%[giveaway:${GIVEAWAY.key}]%`)
    .limit(5000);
  for (const p of prior ?? []) {
    const tag = parseEntryTag(p.internal_notes);
    if (tag && (tag.email_key === emailKey || tag.mobile_key === mobileKey)) {
      return json({ ok: false, error: "duplicate" });
    }
  }

  try {
    // Contact: reuse by email, then phone, else create. Never overwrite a
    // known customer's details with giveaway-form spelling.
    let contactId: string | null = null;
    const { data: byEmail } = await supabase
      .from("contacts").select("id").eq("shop_id", shop.id).ilike("email", email).limit(1).maybeSingle();
    if (byEmail) contactId = byEmail.id;
    if (!contactId) {
      const { data: byPhone } = await supabase
        .from("contacts").select("id, phone").eq("shop_id", shop.id).not("phone", "is", null).limit(5000);
      const hit = (byPhone ?? []).find((c) => normaliseMobile(String(c.phone)) === mobileKey);
      if (hit) contactId = hit.id;
    }
    if (!contactId) {
      const { data: created, error } = await supabase
        .from("contacts")
        .insert({
          shop_id: shop.id,
          first_name: firstName,
          last_name: lastName,
          full_name: `${firstName} ${lastName}`,
          email: email.toLowerCase(),
          phone: mobile,
          notes: "Created from the Oct 2026 giveaway entry form",
        })
        .select("id")
        .single();
      if (error) throw error;
      contactId = created.id;
    }

    // Vehicle: attach if not already on the contact.
    let vehicleId: string | null = null;
    const { data: existingV } = await supabase
      .from("vehicles").select("id").eq("contact_id", contactId).ilike("make", make).ilike("model", model).eq("year", String(year)).maybeSingle();
    if (existingV) vehicleId = existingV.id;
    else {
      const { data: v } = await supabase
        .from("vehicles").insert({ shop_id: shop.id, contact_id: contactId, make, model, year: String(year) }).select("id").single();
      vehicleId = v?.id ?? null;
    }

    // The entry itself. status "won"? No: it's not a sale. "new" + source
    // giveaway keeps it out of the sales queue counts that filter on source.
    const { error: leadErr } = await supabase.from("leads").insert({
      shop_id: shop.id,
      contact_id: contactId,
      vehicle_id: vehicleId,
      source: GIVEAWAY.leadSource,
      source_detail: GIVEAWAY.leadSourceDetail,
      service_requested: "Giveaway entry",
      status: "new",
      landing_url: "https://cleancarcollective.co.nz/giveaway/",
      notes: `Giveaway entry: ${year} ${make} ${model}. Entered ${now.toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" })}${testMode ? " (TEST)" : ""}.`,
      internal_notes: buildEntryTag({ email_key: emailKey, mobile_key: mobileKey, test: testMode }),
    });
    if (leadErr) throw leadErr;

    return json({ ok: true });
  } catch (err) {
    console.error("giveaway entry failed", err);
    return json({ ok: false, error: "server" }, 500);
  }
}

// Visiting the URL in a browser just confirms it's live (matches the old script).
export async function GET() {
  return withCors(new NextResponse("CCC giveaway endpoint is live.", { status: 200 }));
}
