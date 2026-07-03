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
import { judgeCustomerNotes } from "./llmJudgeNotes";
import { classifyVehicleViaLlm } from "./llmVehicleSize";
import { lookupVehicleSizeFromCache } from "./vehicleSizeCache";
import { classifyVehicle } from "./vehicleSizing";
import {
  buildQuotePackages,
  pickTemplateKey,
  templateNeedsSize,
  type QuotePackage,
} from "./templates";
import {
  buildTemplateContext,
  loadAndRenderTemplate,
  type PricingMap,
} from "./templateRenderer";
import type { VehicleSize } from "./vehicleSizing";

const AUTO_ESTIMATE_DELAY_MINUTES = 3;

/**
 * Outcome surfaced to the intake route so the lead form can render an
 * instant on-page quote. "quote" is returned ONLY on the exact same gate
 * as the scheduled auto-send email (no notes blocking, size known, no
 * draft error) — every other path is "escalated" and the customer sees
 * the existing we'll-email-you behavior.
 */
export type AutoRespondOutcome =
  | {
      decision: "quote";
      templateKey: string;
      size: VehicleSize | null;
      packages: QuotePackage[];
      /** Booking-app vehicle type matching the resolved size, for Book-now prefill. */
      bookingVehicleType: string | null;
      /** Ad-promo discount code to pre-apply at booking (e.g. "CCC10"), or null. */
      promoCode: string | null;
    }
  | { decision: "escalated" };

const SIZE_TO_BOOKING_VEHICLE: Record<string, string> = {
  Small: "Coupe / Hatchback",
  Medium: "Sedan / Wagon",
  Large: "Small / Medium SUV",
  XL: "Large SUV / Ute",
};

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
  /** Landing page the lead came from (captured client-side). Used to apply
   *  page-specific ad promos to the quote, e.g. the /10-off-road-trip/ page
   *  auto-discounts the shown prices 10% (code CCC10). */
  landingUrl: string | null;
};

/**
 * Ad-page promos. If a lead's landing_url matches one of these, the auto-quote
 * shows the discounted prices and mentions the code. The actual discount is
 * applied by the booking app at checkout via the code, so this is display-only
 * (no double-discount). Add new ad promos here.
 */
const LANDING_PROMOS: Array<{ match: string; percentOff: number; code: string; label: string }> = [
  // More-specific matches first — "christchurch-10-off-road-trip" also
  // contains "10-off-road-trip", so the CHC entry must be checked first.
  { match: "christchurch-10-off-road-trip", percentOff: 10, code: "CCC10", label: "CHC Road Trip 10% off" },
  { match: "10-off-road-trip", percentOff: 10, code: "CCC10", label: "Road Trip 10% off" },
];

function resolveLandingPromo(landingUrl: string | null) {
  const url = (landingUrl ?? "").toLowerCase();
  if (!url) return null;
  return LANDING_PROMOS.find((p) => url.includes(p.match)) ?? null;
}

/** Return a copy of the pricing map with every price reduced by percentOff. */
function discountPricing(pricing: PricingMap, percentOff: number): PricingMap {
  const factor = 1 - percentOff / 100;
  const out: PricingMap = new Map();
  for (const [key, price] of pricing) out.set(key, Math.round(price * factor));
  return out;
}

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
  // Customer-facing estimate emails now go via Gmail SMTP (Primary tab).
  // Postmark is still used for internal team notifications and webhooks.
  const { sendViaGmailSmtp } = await import("@/lib/email/smtpClient");

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

  // 2. Send via Gmail SMTP (Primary-tab placement).
  let response: { MessageID?: string };
  try {
    response = await sendViaGmailSmtp({
      From: shopContacts.from_line,
      To: args.to,
      Subject: args.subject,
      TextBody: args.textBody,
      HtmlBody: args.htmlBody,
      Metadata: {
        email_message_id: messageRecord.id,
        shop_id: args.shopId,
        lead_id: args.leadId,
        template_key: args.templateKey,
        template_variant: args.templateVariant,
        auto_template_id: args.templateId ?? "none",
      },
    });
  } catch (err) {
    await supabase.from("email_messages").update({ status: "failed" }).eq("id", messageRecord.id);
    throw new Error(`SMTP send failed: ${err instanceof Error ? err.message : String(err)}`);
  }

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

export async function processLeadAutoRespond(input: ProcessLeadInput): Promise<AutoRespondOutcome> {
  const supabase = getSupabaseAdminClient();
  const { leadId, shopId, contactId, firstName, email, makeRaw, modelRaw, serviceRequested, notes, landingUrl } = input;
  const landingPromo = resolveLandingPromo(landingUrl);

  const cleanedNotes = cleanNotes(notes);
  const hasNotes = cleanedNotes.length > 0;
  const templateKey = pickTemplateKey(serviceRequested ?? "");
  const needsSize = templateNeedsSize(templateKey);

  // LLM-judge the notes. ~60% of customer notes are info-only and don't
  // need a human reply ("RAV4 2019, white", "had a dog in it"); the old
  // any-notes-blocks-auto-send rule held those back. The judge sorts
  // notes into auto_ok vs human_needed; only the latter forces approval.
  // Conservative bias inside the prompt + the >=0.7 confidence floor
  // here mean ambiguous notes still escalate to a human.
  let notesVerdict: Awaited<ReturnType<typeof judgeCustomerNotes>> = null;
  if (hasNotes) {
    notesVerdict = await judgeCustomerNotes({
      notes: cleanedNotes,
      serviceRequested,
      vehicleMake: makeRaw,
      vehicleModel: modelRaw,
    });
  }
  const notesAreAutoOk =
    !!notesVerdict && notesVerdict.verdict === "auto_ok" && notesVerdict.confidence >= 0.7;
  // The gate the rest of the pipeline reads. When the judge says
  // auto_ok with high confidence we treat the notes as absent for
  // routing purposes (the deterministic template stands on its own).
  const notesBlockAutoSend = hasNotes && !notesAreAutoOk;

  // Classify vehicle size
  let sizingResult = null;
  if (makeRaw && modelRaw) {
    sizingResult = classifyVehicle(makeRaw, modelRaw);
  }

  let suggestedSize = sizingResult?.size ?? null;
  let confidence = sizingResult?.confidence ?? "low";
  let confNumeric = sizingResult?.confNumeric ?? 0;
  let reasonCode = sizingResult?.reasonCode ?? "unknown_model";
  let canonicalKey = sizingResult?.canonicalKey ?? "";

  // Three-tier vehicle size resolution when MODEL_DB missed:
  //   1. vehicle_size_lookups cache (previously LLM-resolved or
  //      staff-overridden). Free, instant.
  //   2. LLM call (writes back to the cache on success).
  //   3. Caller falls through to the Medium-render fallback +
  //      needs_approval gate.
  let llmSize: Awaited<ReturnType<typeof classifyVehicleViaLlm>> = null;
  if (needsSize && !suggestedSize && makeRaw && modelRaw) {
    const cached = await lookupVehicleSizeFromCache(makeRaw, modelRaw);
    if (cached && cached.confidence >= 0.6) {
      suggestedSize = cached.size;
      confidence = cached.source === "staff_override" || cached.confidence >= 0.85 ? "high" : "medium";
      confNumeric = cached.confidence;
      reasonCode = cached.source === "staff_override" ? "size_cache_staff" : "size_cache_llm";
      canonicalKey = `cache|${makeRaw}|${modelRaw}`;
      console.info("Vehicle size cache hit", { makeRaw, modelRaw, size: cached.size, source: cached.source });
    } else {
      const lookupInput = input as ProcessLeadInput & { vehicleYear?: string | null };
      llmSize = await classifyVehicleViaLlm(makeRaw, modelRaw, lookupInput.vehicleYear ?? null);
      if (llmSize && llmSize.confidence >= 0.6) {
        suggestedSize = llmSize.size;
        confidence = llmSize.confidence >= 0.85 ? "high" : "medium";
        confNumeric = llmSize.confidence;
        reasonCode = "llm_size_lookup";
        canonicalKey = `llm|${makeRaw}|${modelRaw}`;
        console.info("LLM resolved vehicle size", { makeRaw, modelRaw, size: llmSize.size, confidence: llmSize.confidence, rationale: llmSize.rationale });
      }
    }
  }

  // Build draft (always — so staff can review/edit even for approvals)
  let draftSubject = "";
  let draftBody = "";
  let draftHtml = "";
  let draftError = "";
  let templateId: string | null = null;
  let templateVariant: string = "A";

  // Size fallback for RENDERING only — guarantees no "price on request"
  // ever appears in a customer-facing draft. Uses Medium as the safest
  // default. Auto-send is gated separately on actual size confidence,
  // so this fallback only affects emails staff still review.
  const sizeUsedFallback = needsSize && !suggestedSize;
  const effectiveSize: VehicleSize | null = needsSize
    ? (suggestedSize ?? ("Medium" as VehicleSize))
    : null;

  try {
    let pricing = await loadPricing(shopId);
    // Ad-page promo: discount every shown price so the quote reflects the
    // offer (e.g. /10-off-road-trip/ => 10% off, code CCC10).
    if (landingPromo) {
      pricing = discountPricing(pricing, landingPromo.percentOff);
    }
    const ctx = buildTemplateContext(
      templateKey,
      firstName,
      makeRaw ?? "",
      modelRaw ?? "",
      effectiveSize,
      pricing
    );
    // No variant passed — picker will weighted-random pick across active A/B variants
    const rendered = await loadAndRenderTemplate(shopId, templateKey, ctx);
    draftSubject = rendered.subject;
    draftBody = rendered.textBody;
    draftHtml = rendered.htmlBody;
    templateId = rendered.templateId;
    templateVariant = rendered.variant;

    // Ad-page promo: the prices above are already discounted; add a banner so
    // the customer sees the offer is applied, and the code carries to booking.
    if (landingPromo) {
      draftSubject = `${draftSubject} (${landingPromo.percentOff}% off applied)`;
      draftBody =
        `Your ${landingPromo.percentOff}% discount is already applied to the prices below. ` +
        `Code ${landingPromo.code} carries through automatically when you book.\n\n` +
        draftBody;
      const banner =
        `<div style="margin:0 0 18px;padding:12px 16px;background:#0e3b2e;color:#eafff5;` +
        `border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;` +
        `font-size:14px;line-height:1.5;">` +
        `<strong>${landingPromo.percentOff}% off applied</strong> &mdash; the prices below already include your ` +
        `discount. Code <strong>${landingPromo.code}</strong> carries through automatically when you book.</div>`;
      draftHtml = banner + draftHtml;
    }
  } catch (e) {
    draftError = e instanceof Error ? e.message : String(e);
    console.error("Auto-respond draft error:", draftError);
  }

  // Decision logic
  console.log(`Auto-respond decision: lead=${leadId}, template=${templateKey}, needsSize=${needsSize}, suggestedSize=${suggestedSize}, confidence=${confidence} (${Math.round(confNumeric * 100)}%), hasNotes=${hasNotes}, notesVerdict=${notesVerdict?.verdict ?? "n/a"}@${notesVerdict ? Math.round(notesVerdict.confidence * 100) + "%" : "—"}, notesBlockAutoSend=${notesBlockAutoSend}, draftError=${draftError || "none"}`);

  let newStatus = "needs_approval";
  let internalNote = "";
  let emailSent = false;
  let approvalReason: ApprovalReason = "other";
  let approvalReasonDetail: string | null = null;

  // Auto-send only when we're confident in the quote. Three gates:
  //   - no draft error
  //   - no customer notes (those always need human judgement)
  //   - size is actually known (DB hit, fuzzy match, or LLM resolved)
  // The Medium-render fallback above means staff-reviewed approvals
  // still show real prices, but we never blast a wrong-size quote.
  const sizeIsKnown = !needsSize || !!suggestedSize;
  const shouldAutoSend = !draftError && !notesBlockAutoSend && sizeIsKnown;

  if (draftError) {
    newStatus = "needs_approval";
    internalNote = `Draft error: ${draftError}`;
    approvalReason = "draft_error";
    approvalReasonDetail = draftError;
  } else if (notesBlockAutoSend) {
    newStatus = "needs_approval";
    internalNote = notesVerdict
      ? `Needs approval: notes flagged human_needed (${Math.round(notesVerdict.confidence * 100)}% — ${notesVerdict.rationale}).`
      : "Needs approval: notes present (judge unavailable).";
    approvalReason = "notes_present";
  } else if (!sizeIsKnown) {
    newStatus = "needs_approval";
    internalNote = `Needs approval: vehicle size unknown (${makeRaw}/${modelRaw}). Draft uses Medium pricing as fallback.`;
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
      const fallbackNote = sizeUsedFallback
        ? ` (size defaulted to Medium — vehicle ${makeRaw}/${modelRaw} not in DB)`
        : "";
      const judgeNote = notesAreAutoOk && notesVerdict
        ? ` (notes judged auto_ok ${Math.round(notesVerdict.confidence * 100)}% — ${notesVerdict.rationale})`
        : "";
      internalNote = `Auto-send scheduled for ${scheduledFor}${fallbackNote}${judgeNote}`;
      emailSent = false; // not yet — will flip when the job runs
    } catch (e) {
      newStatus = "needs_approval";
      const errMsg = e instanceof Error ? e.message : String(e);
      internalNote = `Schedule failed: ${errMsg}`;
      approvalReason = "send_failed";
      approvalReasonDetail = errMsg;
    }
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

  // Instant on-page quote: only on the exact auto-send path ("scheduled").
  // needs_approval / draft errors / unknown size all fall back to the
  // existing email flow on the customer side.
  if (newStatus === "scheduled") {
    try {
      let quotePricing = await loadPricing(shopId);
      if (landingPromo) {
        quotePricing = discountPricing(quotePricing, landingPromo.percentOff);
      }
      const packages = buildQuotePackages(templateKey, effectiveSize, quotePricing);
      if (packages.length > 0) {
        return {
          decision: "quote",
          templateKey,
          size: effectiveSize,
          packages,
          bookingVehicleType: effectiveSize ? SIZE_TO_BOOKING_VEHICLE[effectiveSize] ?? null : null,
          // Ad-promo code to pre-apply in the booking app (Book-now appends
          // it to the booking URL; null for normal leads).
          promoCode: landingPromo?.code ?? null,
        };
      }
    } catch (err) {
      console.error("buildQuotePackages failed (non-fatal — falling back to email-only)", { leadId, err });
    }
  }
  return { decision: "escalated" };
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
