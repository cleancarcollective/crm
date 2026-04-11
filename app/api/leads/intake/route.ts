import { NextResponse } from "next/server";

import { sendLeadConfirmationEmail } from "@/lib/email/sendLeadConfirmationEmail";
import { sendLeadTeamNotification } from "@/lib/email/sendLeadTeamNotification";
import { parseLeadVehicleInput } from "@/lib/leads/parseVehicleInput";
import { processLeadAutoRespond } from "@/lib/autorespond/processLead";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

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
};

// Lead statuses that indicate an enquiry is still in progress
const OPEN_LEAD_STATUSES = ["new", "contacted", "quoted", "clicked"];

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

  const shopSlug = payload.shop_slug ?? "christchurch";
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

    // ── 4. Emails (non-blocking) ────────────────────────────────────────────
    // Always send customer confirmation and team notification — even on re-enquiries,
    // as the customer expects a receipt and the team needs to know.

    try {
      await sendLeadConfirmationEmail({
        shop,
        firstName: payload.first_name,
        email: payload.email,
        vehicleLabel,
        serviceRequested: payload.service_requested ?? null,
        leadId,
        contactId,
      });
    } catch (confirmError) {
      console.error("Lead confirmation email failed", confirmError);
    }

    try {
      await sendLeadTeamNotification({
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
      });
    } catch (emailError) {
      console.error("Lead team notification failed", emailError);
    }

    // ── 5. Auto-respond (if enabled for this shop) ─────────────────────────
    try {
      const supabaseInner = getSupabaseAdminClient();
      const { data: settings, error: settingsError } = await supabaseInner
        .from("shop_settings")
        .select("auto_respond_enabled")
        .eq("shop_id", shop.id)
        .maybeSingle();

      if (settingsError) {
        console.error("Auto-respond settings query failed:", settingsError.message);
      }

      console.log(`Auto-respond check: shop=${shop.id}, settings=${JSON.stringify(settings)}, enabled=${settings?.auto_respond_enabled}`);

      if (settings?.auto_respond_enabled) {
        await processLeadAutoRespond({
          leadId,
          shopId: shop.id,
          firstName: payload.first_name,
          email: payload.email,
          makeRaw: parsedVehicle.make,
          modelRaw: parsedVehicle.model,
          serviceRequested: payload.service_requested ?? null,
          notes: payload.notes ?? null,
        });
      }
    } catch (autoRespondError) {
      console.error("Auto-respond processing failed", autoRespondError);
    }

    return withCors(NextResponse.json({
      success: true,
      lead_id: leadId,
      contact_id: contactId,
      is_new_contact: isNewContact,
      is_new_lead: isNewLead,
    }));

  } catch (error) {
    console.error("Lead intake failed", error);
    return withCors(NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 }));
  }
}
