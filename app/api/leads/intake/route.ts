import { NextResponse } from "next/server";

import { sendLeadConfirmationEmail } from "@/lib/email/sendLeadConfirmationEmail";
import { sendLeadTeamNotification } from "@/lib/email/sendLeadTeamNotification";
import { parseLeadVehicleInput } from "@/lib/leads/parseVehicleInput";
import { processLeadAutoRespond, type AutoRespondOutcome } from "@/lib/autorespond/processLead";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { signActionToken } from "@/lib/auth/signedTokens";

export type LeadIntakePayload = {
  first_name: string;
  last_name?: string;
  email: string;
  phone?: string;
  vehicle_year?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  service_requested?: string;
  notes?: string;
  shop_slug?: string;
  source?: string;
  // Google Ads attribution — captured by website JS from URL/cookie and
  // forwarded with the form. Used later to upload offline conversion values
  // back to Google Ads when a booking completes.
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  landing_url?: string;
};

// Lead statuses that indicate an enquiry is still in progress
const OPEN_LEAD_STATUSES = ["new", "contacted", "quoted", "clicked"];

// Instant on-page quote shops. Both shops have full pricing + auto-respond,
// so the on-page quote (with Book-now prefill) is live for both. Remove a
// slug here to fall a shop back to the thank-you redirect + email-only route.
// Christchurch removed 2026-07-21: instant quote didn't lift conversions, so
// CHC leads take the classic thank-you redirect + estimate email instead.
// The estimate email still auto-sends and ad-lead nurture still schedules —
// this gate only controls the on-page quote screen.
const QUOTE_ENABLED_SHOP_SLUGS = new Set(["wellington"]);

// Auto-respond runs LLM calls (notes judge, vehicle-size fallback) in the
// hot path — give the route headroom beyond the default 10s.
export const maxDuration = 60;

function withCors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: Request) {
  let payload: LeadIntakePayload;

  try {
    payload = (await request.json()) as LeadIntakePayload;
  } catch {
    return withCors(NextResponse.json({ success: false, error: "Invalid JSON payload." }, { status: 400 }));
  }

  if (!payload.first_name || !payload.email) {
    return withCors(NextResponse.json({ success: false, error: "first_name and email are required." }, { status: 400 }));
  }

  // Multi-tenant: shop_slug is REQUIRED. We used to silently default to
  // Christchurch but that meant a Wellington form forgetting the field
  // would route Wellington leads into the Christchurch shop — silent
  // cross-shop contamination. Now we 400 instead so the form fails loudly.
  const shopSlug = payload.shop_slug;
  if (!shopSlug || typeof shopSlug !== "string") {
    return withCors(NextResponse.json(
      { success: false, error: "Missing required field: shop_slug" },
      { status: 400 }
    ));
  }

  const supabase = getSupabaseAdminClient();
  const parsedVehicle = parseLeadVehicleInput(payload);

  const { data: shop, error: shopError } = await supabase
    .from("shops")
    .select("id, name, slug, timezone")
    .eq("slug", shopSlug)
    .maybeSingle();

  if (shopError || !shop) {
    return withCors(NextResponse.json({ success: false, error: `Shop not found: ${shopSlug}` }, { status: 404 }));
  }

  try {
    const fullName = [payload.first_name, payload.last_name].filter(Boolean).join(" ");

    // ── 1. Resolve contact ──────────────────────────────────────────────────
    // Priority: match by email → match by phone → create new

    let contactId: string;
    let isNewContact = false;

    const { data: contactByEmail } = await supabase
      .from("contacts")
      .select("id")
      .eq("shop_id", shop.id)
      .eq("email", payload.email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (contactByEmail) {
      // Existing contact — update with latest details
      await supabase
        .from("contacts")
        .update({
          first_name: payload.first_name,
          last_name: payload.last_name ?? null,
          full_name: fullName,
          ...(payload.phone ? { phone: payload.phone } : {}),
        })
        .eq("id", contactByEmail.id);
      contactId = contactByEmail.id;

    } else if (payload.phone) {
      // No email match — try phone as fallback
      const { data: contactByPhone } = await supabase
        .from("contacts")
        .select("id")
        .eq("shop_id", shop.id)
        .eq("phone", payload.phone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (contactByPhone) {
        // Update email too since we now have it
        await supabase
          .from("contacts")
          .update({
            first_name: payload.first_name,
            last_name: payload.last_name ?? null,
            full_name: fullName,
            email: payload.email,
            phone: payload.phone,
          })
          .eq("id", contactByPhone.id);
        contactId = contactByPhone.id;

      } else {
        // Genuinely new contact
        const { data: newContact, error: contactError } = await supabase
          .from("contacts")
          .insert({
            shop_id: shop.id,
            first_name: payload.first_name,
            last_name: payload.last_name ?? null,
            full_name: fullName,
            email: payload.email,
            phone: payload.phone,
          })
          .select("id")
          .single();

        if (contactError) throw contactError;
        contactId = newContact.id;
        isNewContact = true;
      }

    } else {
      // No email match and no phone to try — create new contact
      const { data: newContact, error: contactError } = await supabase
        .from("contacts")
        .insert({
          shop_id: shop.id,
          first_name: payload.first_name,
          last_name: payload.last_name ?? null,
          full_name: fullName,
          email: payload.email,
          phone: payload.phone ?? null,
        })
        .select("id")
        .single();

      if (contactError) throw contactError;
      contactId = newContact.id;
      isNewContact = true;
    }

    // ── 2. Resolve vehicle ──────────────────────────────────────────────────
    // Reuse an existing vehicle on this contact if make + model + year all match.
    // Only attempt dedup if all three fields are present.

    let vehicleId: string | null = null;
    const hasVehicle = parsedVehicle.make && parsedVehicle.model && parsedVehicle.year;

    if (hasVehicle) {
      const { data: existingVehicle } = await supabase
        .from("vehicles")
        .select("id")
        .eq("contact_id", contactId)
        .ilike("make", parsedVehicle.make!)
        .ilike("model", parsedVehicle.model!)
        .eq("year", parsedVehicle.year!)
        .maybeSingle();

      if (existingVehicle) {
        vehicleId = existingVehicle.id;
      } else {
        const { data: newVehicle, error: vehicleError } = await supabase
          .from("vehicles")
          .insert({
            shop_id: shop.id,
            contact_id: contactId,
            make: parsedVehicle.make,
            model: parsedVehicle.model,
            year: parsedVehicle.year,
          })
          .select("id")
          .single();

        if (vehicleError) throw vehicleError;
        vehicleId = newVehicle.id;
      }
    } else if (parsedVehicle.make || parsedVehicle.model || parsedVehicle.year) {
      // Partial vehicle info — create a new record rather than risk a wrong match
      const { data: newVehicle, error: vehicleError } = await supabase
        .from("vehicles")
        .insert({
          shop_id: shop.id,
          contact_id: contactId,
          make: parsedVehicle.make,
          model: parsedVehicle.model,
          year: parsedVehicle.year,
        })
        .select("id")
        .single();

      if (vehicleError) throw vehicleError;
      vehicleId = newVehicle.id;
    }

    // ── 3. Resolve lead ─────────────────────────────────────────────────────
    // If an open lead already exists for this contact, update it instead of
    // creating a duplicate. A lead is "open" while it's still being worked.
    // Closed leads (booked / lost) always spawn a fresh lead.

    let leadId: string;
    let isNewLead = false;

    const { data: openLead } = await supabase
      .from("leads")
      .select("id, notes, service_requested")
      .eq("shop_id", shop.id)
      .eq("contact_id", contactId)
      .in("status", OPEN_LEAD_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openLead) {
      // Build updated notes — append new notes if they differ
      const existingNotes = openLead.notes ?? "";
      const incomingNotes = payload.notes ?? "";
      const updatedNotes = incomingNotes && incomingNotes !== existingNotes
        ? existingNotes
          ? `${existingNotes}\n\n[Re-enquiry] ${incomingNotes}`
          : incomingNotes
        : existingNotes || null;

      await supabase
        .from("leads")
        .update({
          // Update service if a new one was provided
          ...(payload.service_requested ? { service_requested: payload.service_requested } : {}),
          // Update vehicle if we resolved one
          ...(vehicleId ? { vehicle_id: vehicleId } : {}),
          notes: updatedNotes,
          source_detail: "Re-enquiry via lead form",
        })
        .eq("id", openLead.id);

      leadId = openLead.id;

    } else {
      const { data: newLead, error: leadError } = await supabase
        .from("leads")
        .insert({
          shop_id: shop.id,
          contact_id: contactId,
          vehicle_id: vehicleId,
          source: payload.source ?? "website-lead-form",
          source_detail: "Lead form submission",
          service_requested: payload.service_requested ?? null,
          notes: payload.notes ?? null,
          status: "new",
          gclid: payload.gclid ?? null,
          gbraid: payload.gbraid ?? null,
          wbraid: payload.wbraid ?? null,
          landing_url: payload.landing_url ?? null,
        })
        .select("id")
        .single();

      if (leadError) throw leadError;
      leadId = newLead.id;
      isNewLead = true;
    }

    console.info("Lead intake resolved", {
      contactId,
      leadId,
      isNewContact,
      isNewLead,
      vehicleId,
    });

    const vehicleLabel = [parsedVehicle.year, parsedVehicle.make, parsedVehicle.model].filter(Boolean).join(" ") || null;

    // ── 4. Emails + auto-respond (all in parallel to stay within timeout) ──
    // NOTE: lead-confirmation auto-reply intentionally OFF. It trained Gmail
    // to classify our sends as promotional (immediate templated reply to a
    // form submission is the classic Promotions signal). The customer gets
    // the actual estimate within ~3 minutes from the auto-respond path,
    // which is the email that actually matters.
    const results = await Promise.allSettled([
      // sendLeadConfirmationEmail intentionally disabled — see comment above
      Promise.resolve({ skipped: true as const }),

      sendLeadTeamNotification({
        shop,
        lead: {
          id: leadId,
          contact_id: contactId,
          first_name: payload.first_name,
          last_name: payload.last_name ?? null,
          email: payload.email,
          phone: payload.phone ?? null,
          vehicle_year: parsedVehicle.year,
          vehicle_make: parsedVehicle.make,
          vehicle_model: parsedVehicle.model,
          service_requested: payload.service_requested ?? null,
          notes: payload.notes ?? null,
        },
      }),

      // Auto-respond (check setting, then process if enabled). Returns an
      // AutoRespondOutcome so the response can carry an instant on-page
      // quote when the auto-send gate passes.
      (async (): Promise<AutoRespondOutcome | null> => {
        const supabaseInner = getSupabaseAdminClient();
        const { data: settings, error: settingsError } = await supabaseInner
          .from("shop_settings")
          .select("auto_respond_enabled")
          .eq("shop_id", shop.id)
          .maybeSingle();

        if (settingsError) {
          console.error("Auto-respond settings query failed:", settingsError.message);
          return null;
        }

        if (!settings?.auto_respond_enabled) return null;

        return processLeadAutoRespond({
          leadId,
          shopId: shop.id,
          contactId,
          firstName: payload.first_name,
          email: payload.email,
          makeRaw: parsedVehicle.make,
          modelRaw: parsedVehicle.model,
          serviceRequested: payload.service_requested ?? null,
          notes: payload.notes ?? null,
          landingUrl: payload.landing_url ?? null,
          phone: payload.phone ?? null,
          shopSlug: shop.slug,
        });
      })(),
    ]);

    // Log any failures
    const labels = ["confirmation_email", "team_notification", "auto_respond"];
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") {
        console.error(`${labels[i]} failed:`, (results[i] as PromiseRejectedResult).reason);
      }
    }

    // Instant on-page quote payload. Present only when auto-respond ran
    // and hit the auto-send gate; the lead form falls back to the
    // "we'll email you" screen whenever this is absent.
    const autoRespondResult = results[2];
    const quoteReady =
      autoRespondResult.status === "fulfilled" &&
      autoRespondResult.value &&
      (autoRespondResult.value as AutoRespondOutcome).decision === "quote"
        ? (autoRespondResult.value as Extract<AutoRespondOutcome, { decision: "quote" }>)
        : null;

    // Wellington-only launch: only surface the quote to enabled shops.
    const quote = QUOTE_ENABLED_SHOP_SLUGS.has(shop.slug) ? quoteReady : null;

    // Layer-1 tracking: stamp the lead the moment we actually show a quote,
    // so "quote_shown → booking" has a reliable denominator. Non-blocking.
    if (quote) {
      void getSupabaseAdminClient()
        .from("leads")
        .update({ quote_shown_at: new Date().toISOString() })
        .eq("id", leadId)
        .then(({ error }) => {
          if (error) console.error("quote_shown_at stamp failed (non-fatal)", error.message);
        });
    }

    // Short-lived token so a "Book" click can prefill the booking form with
    // the contact + vehicle details the customer just entered — without any
    // PII in the URL. Exchanged at /api/public/booking-prefill.
    const prefillToken = quote
      ? signActionToken({ a: "booking_prefill", r: leadId, s: shop.id }, 2 * 60 * 60)
      : null;

    return withCors(NextResponse.json({
      success: true,
      lead_id: leadId,
      contact_id: contactId,
      is_new_contact: isNewContact,
      is_new_lead: isNewLead,
      quote: quote
        ? {
            template_key: quote.templateKey,
            size: quote.size,
            booking_vehicle_type: quote.bookingVehicleType,
            prefill_token: prefillToken,
            promo_code: quote.promoCode,
            promo_percent_off: quote.promoPercentOff,
            packages: quote.packages.map((p) => ({
              name: p.name,
              price: p.price,
              price_label: p.priceLabel,
              original_price_label: p.originalPriceLabel ?? null,
              duration: p.duration,
              highlights: p.highlights,
              booking_service_id: p.bookingServiceId,
            })),
          }
        : null,
    }));

  } catch (error) {
    console.error("Lead intake failed", error);
    return withCors(NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 }));
  }
}
