import { NextResponse } from "next/server";

import { sendLeadConfirmationEmail } from "@/lib/email/sendLeadConfirmationEmail";
import { sendLeadTeamNotification } from "@/lib/email/sendLeadTeamNotification";
import { sendEstimateAutomationBridge } from "@/lib/leads/sendEstimateAutomationBridge";
import { parseLeadVehicleInput } from "@/lib/leads/parseVehicleInput";
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
    // Upsert contact
    const fullName = [payload.first_name, payload.last_name].filter(Boolean).join(" ");

    const { data: existingContact } = await supabase
      .from("contacts")
      .select("id")
      .eq("shop_id", shop.id)
      .eq("email", payload.email)
      .maybeSingle();

    let contactId: string;

    if (existingContact) {
      await supabase
        .from("contacts")
        .update({
          first_name: payload.first_name,
          last_name: payload.last_name ?? null,
          full_name: fullName,
          phone: payload.phone ?? null,
        })
        .eq("id", existingContact.id);
      contactId = existingContact.id;
    } else {
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
    }

    // Create vehicle if details provided
    let vehicleId: string | null = null;
    const hasVehicle = parsedVehicle.make || parsedVehicle.model || parsedVehicle.year;

    if (hasVehicle) {
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

    // Create lead
    const { data: lead, error: leadError } = await supabase
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

    const vehicleLabel = [parsedVehicle.year, parsedVehicle.make, parsedVehicle.model].filter(Boolean).join(" ") || null;

    // Send customer confirmation (non-blocking)
    try {
      await sendLeadConfirmationEmail({
        shop,
        firstName: payload.first_name,
        email: payload.email,
        vehicleLabel,
        serviceRequested: payload.service_requested ?? null,
        leadId: lead.id,
      });
    } catch (confirmError) {
      console.error("Lead confirmation email failed", confirmError);
    }

    // Send team notification (non-blocking)
    try {
      await sendLeadTeamNotification({
        shop,
        lead: {
          id: lead.id,
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

    try {
      await sendEstimateAutomationBridge({
        shop,
        lead: {
          full_name: fullName,
          email: payload.email,
          phone: payload.phone ?? null,
          service_requested: payload.service_requested ?? null,
          notes: payload.notes ?? null,
          source: payload.source ?? "website-lead-form",
          vehicle_year: parsedVehicle.year,
          vehicle_make: parsedVehicle.make,
          vehicle_model: parsedVehicle.model,
        },
      });
    } catch (bridgeError) {
      console.error("Estimate automation bridge failed", bridgeError);
    }

    return withCors(NextResponse.json({ success: true, lead_id: lead.id, contact_id: contactId }));
  } catch (error) {
    console.error("Lead intake failed", error);
    return withCors(NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 }));
  }
}
