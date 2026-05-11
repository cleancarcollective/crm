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
import { getShopContactsById } from "@/lib/email/shopContacts";
import { sendApprovalRequestEmail, type ApprovalReason } from "@/lib/email/sendApprovalRequestEmail";
import { scheduleLeadJob } from "@/lib/scheduling/leadJobs";
import { llmDraftQuote, type LlmDraftInput } from "./llmDraftQuote";
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

const AUTO_ESTIMATE_DELAY_MINUTES = 3;

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

export type SendEstimateArgs = {
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
 * Tracking is currently OFF (TrackLinks + TrackOpens) to keep estimate
 * emails out of Gmail's Promotions tab. Postmark's link rewriter
 * (click.postmarkapp.com) is a strong Gmail-Promotions signal on
 * transactional-style emails like this. We still track conversions via
 * the booking intake → lead status=won flow, so the main funnel metric
 * is preserved. When we set up a custom Postmark link-tracking domain
 * (e.g. links.cleancarcollective.co.nz), tracking can be turned back
 * on without the deliverability cost.
 */
export async function sendEstimateEmail(args: SendEstimateArgs) {
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

  // Resolve the per-shop sender name (Christchurch = Ben, Wellington = Max).
  const shopContacts = await getShopContactsById(args.shopId);

  // 2. Send via Postmark with full tracking + attribution metadata.
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": postmarkToken,
    },
    body: JSON.stringify({
      From: shopContacts.from_line,
      To: args.to,
      Subject: args.subject,
      TextBody: args.textBody,
      HtmlBody: args.htmlBody,
      MessageStream: "booking-emails",
      TrackOpens: false,
      TrackLinks: "None",
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
    // No variant passed — picker will weighted-random pick across active A/B variants
    const rendered = await loadAndRenderTemplate(shopId, templateKey, ctx);
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
  let approvalReason: ApprovalReason = "other";
  let approvalReasonDetail: string | null = null;

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
    approvalReason = "draft_error";
    approvalReasonDetail = draftError;
  } else if (hasNotes) {
    newStatus = "needs_approval";
    internalNote = "Needs approval: notes present.";
    approvalReason = "notes_present";
  } else if (needsSize && !suggestedSize) {
    newStatus = "needs_approval";
    internalNote = "Needs approval: vehicle size unknown.";
    approvalReason = "vehicle_size_unknown";
  } else if (shouldAutoSend) {
    // Schedule the estimate send for 3 minutes from now — feels more human
    // than an instant auto-reply, gives the customer time to read the
    // confirmation email first.
    try {
      const scheduledFor = new Date(Date.now() + AUTO_ESTIMATE_DELAY_MINUTES * 60 * 1000).toISOString();
      await scheduleLeadJob({
        shopId,
        leadId,
        contactId,
        jobType: "lead_auto_estimate",
        templateKey,
        scheduledFor,
        payload: {
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
        },
      });
      newStatus = "scheduled";
      internalNote = `Auto-send scheduled for ${scheduledFor}`;
      emailSent = false; // not yet — will flip when the job runs
    } catch (e) {
      newStatus = "needs_approval";
      const errMsg = e instanceof Error ? e.message : String(e);
      internalNote = `Schedule failed: ${errMsg}`;
      approvalReason = "send_failed";
      approvalReasonDetail = errMsg;
    }
  } else {
    newStatus = "needs_approval";
    internalNote = `Needs approval: confidence ${confidence} (${Math.round(confNumeric * 100)}%, reason: ${reasonCode}).`;
    approvalReason = "low_confidence";
  }

  // ── LLM note-response injection ──────────────────────────────────────────
  // The deterministic template handles greeting + pricing + sign-off.
  // When the customer left notes, ask Claude to write a 1-3 sentence
  // paragraph addressing those notes; we inject it into the template body
  // before the "Please let me know..." line. The template itself is
  // never rewritten.
  //
  // Only runs when notes are present AND we have a deterministic draft.
  // Failures are non-fatal — the deterministic draft remains as-is.
  let llmConfidence: number | null = null;
  if (
    newStatus === "needs_approval" &&
    process.env.OPENROUTER_API_KEY &&
    hasNotes &&
    !draftError &&
    draftBody
  ) {
    try {
      const contacts = await getShopContactsById(shopId);
      const { data: shopRow } = await supabase
        .from("shops")
        .select("name, slug")
        .eq("id", shopId)
        .single();
      const { data: leadRow } = await supabase
        .from("leads")
        .select("vehicle_id, vehicles(year)")
        .eq("id", leadId)
        .maybeSingle();
      const vehicleYear =
        ((leadRow?.vehicles as unknown) as { year: string | null } | null)?.year ?? null;

      const llmInput: LlmDraftInput = {
        shopId,
        shopName: shopRow?.name ?? "Clean Car Collective",
        shopSlug: shopRow?.slug ?? "",
        senderFirstName: contacts.sender_name,
        bookingUrl: `${contacts.website}/make-a-booking`,
        reason: "notes_present",
        firstName,
        serviceRequested,
        vehicleMake: makeRaw,
        vehicleModel: modelRaw,
        vehicleYear,
        customerNotes: notes,
        deterministicSubject: draftSubject,
        deterministicBody: draftBody,
      };
      const llm = await llmDraftQuote(llmInput);

      // Template stays canonical; we only swap the body to the version
      // with the LLM's paragraph injected. Subject is unchanged from
      // the deterministic render.
      draftBody = llm.body;
      draftHtml = llm.htmlBody;
      llmConfidence = llm.confidence;
      internalNote = llm.noteResponse
        ? `LLM injected note-response (confidence ${Math.round(llm.confidence * 100)}%): "${llm.noteResponse.slice(0, 140)}"${llm.needsMoreInfo ? ` · ${llm.needsMoreInfo}` : ""}`
        : `LLM ran but produced no note-response. ${llm.internalNotes}`;
      console.info("LLM note-response generated", {
        leadId,
        confidence: llm.confidence,
        injected: !!llm.noteResponse,
        needsMoreInfo: !!llm.needsMoreInfo,
        promptTokens: llm.usage.promptTokens,
        completionTokens: llm.usage.completionTokens,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("LLM draft failed (non-fatal — falling back to deterministic draft)", {
        leadId,
        err: msg,
      });
      internalNote += ` LLM draft attempt failed: ${msg}.`;
    }
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

  // If the lead needs human approval, email the team with the draft + a
  // direct link to review and send it from the CRM. Failures here are
  // logged but don't bubble up — the lead is safely saved already.
  if (newStatus === "needs_approval") {
    try {
      await sendApprovalEmailForLead({
        leadId,
        shopId,
        contactId,
        firstName,
        email,
        makeRaw,
        modelRaw,
        serviceRequested,
        customerNotes: notes,
        reason: approvalReason,
        reasonDetail: approvalReasonDetail,
        estimate: { subject: draftSubject, body: draftBody },
      });
    } catch (err) {
      console.error("Approval request email failed (non-fatal)", { leadId, err });
    }
  }
}

/**
 * Helper: fetch the shop + contact records needed for the approval email,
 * then send it. Kept here so processLeadAutoRespond's signature doesn't
 * need to balloon to carry all the customer/shop details.
 */
async function sendApprovalEmailForLead(args: {
  leadId: string;
  shopId: string;
  contactId: string | null;
  firstName: string;
  email: string;
  makeRaw: string | null;
  modelRaw: string | null;
  serviceRequested: string | null;
  customerNotes: string | null;
  reason: ApprovalReason;
  reasonDetail: string | null;
  estimate: { subject: string; body: string };
}) {
  const supabase = getSupabaseAdminClient();

  const { data: shop } = await supabase
    .from("shops")
    .select("id, name, slug, timezone")
    .eq("id", args.shopId)
    .maybeSingle();

  if (!shop) {
    console.warn("Approval email skipped — shop not found", { shopId: args.shopId });
    return;
  }

  // Optional enrichment from the contact row (last_name, phone).
  let lastName: string | null = null;
  let phone: string | null = null;
  if (args.contactId) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("last_name, phone")
      .eq("id", args.contactId)
      .maybeSingle();
    lastName = contact?.last_name ?? null;
    phone = contact?.phone ?? null;
  }

  // Vehicle year — not passed through the auto-respond input, so fetch from
  // the lead's vehicle link. Non-blocking: if missing we just omit it.
  let vehicleYear: string | null = null;
  const { data: lead } = await supabase
    .from("leads")
    .select("vehicle_id")
    .eq("id", args.leadId)
    .maybeSingle();
  if (lead?.vehicle_id) {
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("year")
      .eq("id", lead.vehicle_id)
      .maybeSingle();
    vehicleYear = vehicle?.year ? String(vehicle.year) : null;
  }

  await sendApprovalRequestEmail({
    shop: shop as { id: string; name: string; slug: string; timezone: string },
    leadId: args.leadId,
    contactId: args.contactId,
    customer: {
      firstName: args.firstName,
      lastName,
      email: args.email,
      phone,
    },
    vehicle: {
      year: vehicleYear,
      make: args.makeRaw,
      model: args.modelRaw,
    },
    serviceRequested: args.serviceRequested,
    customerNotes: args.customerNotes,
    reason: args.reason,
    reasonDetail: args.reasonDetail,
    estimate: args.estimate,
  });
}
