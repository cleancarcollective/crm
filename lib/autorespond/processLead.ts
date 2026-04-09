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
  buildEstimateDraft,
  pickTemplateKey,
  templateNeedsSize,
  type PricingMap,
} from "./templates";
import type { VehicleSize } from "./vehicleSizing";

type ProcessLeadInput = {
  leadId: string;
  shopId: string;
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

async function sendEstimateEmail(
  email: string,
  subject: string,
  textBody: string,
  htmlBody: string
) {
  const postmarkToken = process.env.POSTMARK_API_TOKEN;
  if (!postmarkToken) throw new Error("POSTMARK_API_TOKEN not set");

  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": postmarkToken,
    },
    body: JSON.stringify({
      From: "Max from Clean Car Collective <max@cleancarcollective.co.nz>",
      To: email,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
      MessageStream: "booking-emails",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Postmark send failed ${res.status}: ${text.slice(0, 200)}`);
  }
}

export async function processLeadAutoRespond(input: ProcessLeadInput): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { leadId, shopId, firstName, email, makeRaw, modelRaw, serviceRequested, notes } = input;

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

  try {
    const pricing = await loadPricing(shopId);
    const sizeForTemplate: VehicleSize | null = needsSize ? suggestedSize : null;
    const draft = buildEstimateDraft(
      templateKey,
      firstName,
      makeRaw ?? "",
      modelRaw ?? "",
      sizeForTemplate,
      pricing
    );
    draftSubject = draft.subject;
    draftBody = draft.textBody;
    draftHtml = draft.htmlBody;
  } catch (e) {
    draftError = e instanceof Error ? e.message : String(e);
    console.error("Auto-respond draft error:", draftError);
  }

  // Decision logic
  let newStatus = "needs_approval";
  let internalNote = "";
  let emailSent = false;

  if (draftError) {
    newStatus = "needs_approval";
    internalNote = `Draft error: ${draftError}`;
  } else if (hasNotes) {
    newStatus = "needs_approval";
    internalNote = "Needs approval: notes present.";
  } else if (needsSize && !suggestedSize) {
    newStatus = "needs_approval";
    internalNote = "Needs approval: vehicle size unknown.";
  } else if (confidence === "high") {
    // Auto send
    try {
      await sendEstimateEmail(email, draftSubject, draftBody, draftHtml);
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
  await supabase.from("leads").update({
    status: newStatus,
    template_key: templateKey,
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

  console.info("Auto-respond processed", {
    leadId,
    status: newStatus,
    confidence,
    reasonCode,
    emailSent,
  });
}
