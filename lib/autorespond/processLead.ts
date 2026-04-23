/**
 * Auto-respond lead processing.
 * Called from the lead intake route when auto_respond_enabled = true.
 *
 * Logic (mirrors GAS automation):
 * 1. Has notes? -> needs_approval (always)
 * 2. No notes:
 *    - High confidence size? -> auto send
 *    - Medium/low or unknown? -> needs_approval
 * 3. Template needs size but none found? -> needs_approval
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { classifyVehicle } from "./vehicleSizing";
import {
  pickTemplateKey,
  templateNeedsSize,
} from "./templates";
import {
  buildTemplateContext,
  loadAndRenderTemplate,
  type PricingMap,
} from "./templateRenderer";
import type { VehicleSize } from "./vehicleSizing";

type ProcessLeadInput = {
  leadId: string;
  shopId: string;
  contactId: string | null;
  firstName: string;
  email: string;
  makeRaw: string | null;
  modelRaw: string | null;
  serviceRequested: string | null;
  notes: string | null;
};

function cleanNotes(s: string | null): string {
  const raw = (s || "").trim();
  const v = raw.toLowerCase();
  if (!v) return "";
  if (["no response", "no notes", "n/a", "na", "none", "-"].includes(v)) return "";
  return raw;
}

async function loadPricing(shopId: string): Promise<PricingMap> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("pricing")
    .select("service_name, size, price_ex_gst")
    .eq("shop_id", shopId);

  if (error) throw new Error("Failed to load pricing: " + error.message);

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set(`${row.service_name}|${row.size}`, Number(row.price_ex_gst));
  }
  return map;
}

type SendEstimateArgs = {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  shopId: string;
  leadId: string;
  contactId: string | null;
  templateId: string | null;
  templateKey: string;
  templateVariant: string;
};

/**
 * Send the auto-respond estimate email with full tracking + attribution.
 *
 * Creates an `email_messages` row BEFORE sending, so we have a stable ID to
 * pass to Postmark as Metadata. Postmark click/open webhooks reference this
 * ID back to the lead.
 *
 * Enables TrackLinks (reliable) + TrackOpens (noisy due to Apple MPP but
 * still useful as a weak signal).
 */
async function sendEstimateEmail(args: SendEstimateArgs) {
  const postmarkToken = process.env.POSTMARK_SERVER_TOKEN;
  if (!postmarkToken) throw new Error("POSTMARK_SERVER_TOKEN not set");

  const supabase = getSupabaseAdminClient();

  // 1. Record email in email_messages (status: queued) so click/open events can
  //    be attributed back via the stable id.
  const { data: messageRecord, error: insertError } = await supabase
    .from("email_messages")
    .insert({
      shop_id: args.shopId,
      contact_id: args.contactId,
      lead_id: args.leadId,
      booking_id: null,
      template_id: null, // legacy booking templates live in this column; ours is in Metadata
      subject: args.subject,
      body_rendered: args.htmlBody,
      status: "queued",
    })
    .select("id")
    .single();

  if (insertError || !messageRecord) {
    throw new Error(`email_messages insert failed: ${insertError?.message ?? "no row returned"}`);
  }

  // 2. Send via Postmark with full tracking + attribution metadata.
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": postmarkToken,
    },
    body: JSON.stringify({
      From: "Max from Clean Car Collective <max@cleancarcollective.co.nz>",
      To: args.to,
      Subject: args.subject,
      TextBody: args.textBody,
      HtmlBody: args.htmlBody,
      MessageStream: "booking-emails",
      TrackOpens: true,
      TrackLinks: "HtmlAndText",
      Metadata: {
        email_message_id: messageRecord.id,
        shop_id: args.shopId,
        lead_id: args.leadId,
        template_key: args.templateKey,
        template_variant: args.templateVariant,
        auto_template_id: args.templateId ?? "none",
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    await supabase.from("email_messages").update({ status: "failed" }).eq("id", messageRecord.id);
    throw new Error(`Postmark send failed ${res.status}: ${text.slice(0, 200)}`);
  }

  const response = (await res.json()) as { MessageID?: string };

  // 3. Mark email_messages as sent + record provider id
  await supabase
    .from("email_messages")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      provider_message_id: response.MessageID ?? null,
    })
    .eq("id", messageRecord.id);
}

export async function processLeadAutoRespond(input: ProcessLeadInput): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { leadId, shopId, contactId, firstName, email, makeRaw, modelRaw, serviceRequested, notes } = input;

  const cleanedNotes = cleanNotes(notes);
  const hasNotes = cleanedNotes.length > 0;
  const templateKey = pickTemplateKey(serviceRequested ?? "");
  const needsSize = templateNeedsSize(templateKey);

  // Classify vehicle size
  let sizingResult = null;
  if (makeRaw && modelRaw) {
    sizingResult = classifyVehicle(makeRaw, modelRaw);
  }

  const suggestedSize = sizingResult?.size ?? null;
  const confidence = sizingResult?.confidence ?? "low";
  const confNumeric = sizingResult?.confNumeric ?? 0;
  const reasonCode = sizingResult?.reasonCode ?? "unknown_model";
  const canonicalKey = sizingResult?.canonicalKey ?? "";

  // Build draft (always — so staff can review/edit even for approvals)
  let draftSubject = "";
  let draftBody = "";
  let draftHtml = "";
  let draftError = "";
  let templateId: string | null = null;
  let templateVariant: string = "A";

  try {
    const pricing = await loadPricing(shopId);
    const sizeForTemplate: VehicleSize | null = needsSize ? suggestedSize : null;
    const ctx = buildTemplateContext(
      templateKey,
      firstName,
      makeRaw ?? "",
      modelRaw ?? "",
      sizeForTemplate,
      pricing
    );
    const rendered = await loadAndRenderTemplate(shopId, templateKey, ctx, "A");
    draftSubject = rendered.subject;
    draftBody = rendered.textBody;
    draftHtml = rendered.htmlBody;
    templateId = rendered.templateId;
    templateVariant = rendered.variant;
  } catch (e) {
    draftError = e instanceof Error ? e.message : String(e);
    console.error("Auto-respond draft error:", draftError);
  }

  // Decision logic
  console.log(`Auto-respond decision: lead=${leadId}, template=${templateKey}, needsSize=${needsSize}, suggestedSize=${suggestedSize}, confidence=${confidence} (${Math.round(confNumeric * 100)}%), hasNotes=${hasNotes}, draftError=${draftError || "none"}`);

  let newStatus = "needs_approval";
  let internalNote = "";
  let emailSent = false;

  // Size-independent templates (ceramic, paint_correction, other) use the
  // vehicle name only as a display string — they don't need size confidence.
  // So for those, we can auto-send even with low confidence.
  const canAutoSendDespiteLowConfidence = !needsSize;
  const shouldAutoSend =
    !draftError &&
    !hasNotes &&
    !(needsSize && !suggestedSize) &&
    (confidence === "high" || canAutoSendDespiteLowConfidence);

  if (draftError) {
    newStatus = "needs_approval";
    internalNote = `Draft error: ${draftError}`;
  } else if (hasNotes) {
    newStatus = "needs_approval";
    internalNote = "Needs approval: notes present.";
  } else if (needsSize && !suggestedSize) {
    newStatus = "needs_approval";
    internalNote = "Needs approval: vehicle size unknown.";
  } else if (shouldAutoSend) {
    // Auto send
    try {
      await sendEstimateEmail({
        to: email,
        subject: draftSubject,
        textBody: draftBody,
        htmlBody: draftHtml,
        shopId,
        leadId,
        contactId,
        templateId,
        templateKey,
        templateVariant,
      });
      newStatus = "sent";
      internalNote = "";
      emailSent = true;
    } catch (e) {
      newStatus = "needs_approval";
      internalNote = `Send failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    newStatus = "needs_approval";
    internalNote = `Needs approval: confidence ${confidence} (${Math.round(confNumeric * 100)}%, reason: ${reasonCode}).`;
  }

  // Update lead record
  const { error: updateError } = await supabase.from("leads").update({
    status: newStatus,
    template_key: templateKey,
    template_id: templateId,
    template_variant: templateVariant,
    suggested_size: suggestedSize,
    confidence,
    reason_code: reasonCode,
    canonical_key: canonicalKey,
    quote_subject: draftSubject,
    quote_body: draftBody,
    quote_html: draftHtml,
    internal_notes: internalNote,
    ...(emailSent ? { booked_at: null } : {}), // don't set booked_at on send
    updated_at: new Date().toISOString(),
  }).eq("id", leadId);

  if (updateError) {
    throw new Error(`Lead update failed: ${updateError.message} (code: ${updateError.code})`);
  }

  console.info("Auto-respond processed", {
    leadId,
    status: newStatus,
    confidence,
    reasonCode,
    emailSent,
  });
}
