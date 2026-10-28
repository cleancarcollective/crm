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
 * Rules (mirroring the Apps Script it replaced, plus referrals):
 *   - entry window enforced server-side (NZ time)
 *   - honeypot field: bots get { ok: true } and nothing is saved
 *   - one entry per person, matched on normalised email OR mobile
 *     (gmail dots and +tags ignored, +64 / 0064 / 64 collapsed to 0)
 *   - formula-injection chars stripped so a CSV export can't execute
 *   - every entrant gets a referral code; an optional `ref` is validated
 *     against existing entries and credited as a ticket to the referrer
 *
 * GET /api/giveaway/enter?code=XXXXXXXX returns that entrant's ticket count
 * so the success screen can show "You have N entries".
 */

import { NextRequest, NextResponse, after } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { fetchAllGiveawayLeads } from "@/lib/giveaway/fetchEntries";
import {
  GIVEAWAY, REFERRAL, clean, normaliseEmail, normaliseMobile, buildEntryTag, parseEntryTag,
  newReferralCode, normaliseReferralCode, shareUrlFor, referralCounts, ticketsFor, type EntryTag,
} from "@/lib/giveaway/wlgOct2026";
import { sendGiveawayEntryEmail } from "@/lib/giveaway/sendEntryEmail";

export const dynamic = "force-dynamic";

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}
export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

const json = (body: Record<string, unknown>, status = 200) => withCors(NextResponse.json(body, { status }));

type SupabaseAdmin = ReturnType<typeof getSupabaseAdminClient>;
type Entry = { id: string; tag: EntryTag };

async function loadEntries(supabase: SupabaseAdmin, shopId: string): Promise<Entry[]> {
  const data = await fetchAllGiveawayLeads<{ id: string; internal_notes: string | null }>(supabase, shopId, "id, internal_notes");
  return data
    .map((p) => ({ id: String(p.id), tag: parseEntryTag(p.internal_notes) }))
    .filter((p): p is Entry => p.tag !== null);
}


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
  const ref = normaliseReferralCode(d.ref);

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
  // doesn't depend on how the contact row was spelled. The same pass
  // collects issued codes and resolves the referrer, if any.
  const prior = await loadEntries(supabase, shop.id);
  const usedCodes = new Set<string>();
  let referrer: Entry | null = null;
  for (const p of prior) {
    if (p.tag.code) usedCodes.add(p.tag.code);
    if (p.tag.email_key === emailKey || p.tag.mobile_key === mobileKey) {
      // Already in. Hand back their share link so the page can show it again.
      return json({
        ok: false,
        error: "duplicate",
        code: p.tag.code ?? null,
        share_url: p.tag.code ? shareUrlFor(p.tag.code) : null,
      });
    }
    if (ref && p.tag.code === ref) referrer = p;
  }
  let code = newReferralCode();
  while (usedCodes.has(code)) code = newReferralCode();
  // A referral only counts between entries of the same kind: a test entry
  // can't earn a real ticket and vice versa.
  const refApplied = referrer !== null && referrer.tag.test === testMode;

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

    // The entry itself. status "new" + source giveaway keeps it out of the
    // sales queue counts that filter on source.
    const tag: EntryTag = { email_key: emailKey, mobile_key: mobileKey, test: testMode, code };
    if (refApplied && ref) tag.ref = ref;
    const { error: leadErr } = await supabase.from("leads").insert({
      shop_id: shop.id,
      contact_id: contactId,
      vehicle_id: vehicleId,
      source: GIVEAWAY.leadSource,
      source_detail: GIVEAWAY.leadSourceDetail,
      service_requested: "Giveaway entry",
      status: "new",
      landing_url: "https://cleancarcollective.co.nz/giveaway/",
      notes:
        `Giveaway entry: ${year} ${make} ${model}. Entered ${now.toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" })}` +
        `${testMode ? " (TEST)" : ""}. Share code ${code}.${refApplied ? ` Came in through referral link ${ref}.` : ""}`,
      internal_notes: buildEntryTag(tag),
    });
    if (leadErr) throw leadErr;

    // Confirmation email with the share link, sent after the response goes
    // out so SMTP latency never slows the form. Failure is logged, not surfaced.
    after(async () => {
      try {
        await sendGiveawayEntryEmail({ shopId: shop.id, to: email, firstName, code, test: testMode });
      } catch (err) {
        console.error("giveaway entry email failed", err);
      }
    });

    return json({ ok: true, code, share_url: shareUrlFor(code), ref_applied: refApplied });
  } catch (err) {
    console.error("giveaway entry failed", err);
    return json({ ok: false, error: "server" }, 500);
  }
}

// GET without a code just confirms the endpoint is live (matches the old
// script). GET ?code=... returns that entrant's ticket count for the share
// screen. Codes are random and reveal nothing but a count.
export async function GET(req: NextRequest) {
  const code = normaliseReferralCode(req.nextUrl.searchParams.get("code"));
  if (!code) return withCors(new NextResponse("CCC giveaway endpoint is live.", { status: 200 }));

  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("slug", GIVEAWAY.shopSlug).maybeSingle();
  if (!shop) return json({ ok: false, error: "server" }, 500);

  const entries = await loadEntries(supabase, shop.id);
  const me = entries.find((e) => e.tag.code === code);
  if (!me) return json({ ok: false, error: "unknown" }, 404);

  const counts = referralCounts(entries.filter((e) => e.tag.test === me.tag.test));
  const referrals = counts.get(code) ?? 0;
  return json({ ok: true, referrals, entries: ticketsFor(me.tag, counts), max_extra: REFERRAL.maxExtraEntries });
}
