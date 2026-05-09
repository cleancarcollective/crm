/**
 * LLM-drafted quote fallback. Called when the deterministic auto-respond
 * can't confidently send (vague vehicle, complex notes, low size confidence).
 *
 * Phase 1 (current): drafts the email body + suggested price + confidence
 * score. The lead still lands in `needs_approval` so a human one-click
 * sends it. This builds trust in the LLM's calibration over a few weeks
 * before we flip on auto-send.
 *
 * Phase 2 (later): when shop_settings.llm_auto_send_threshold is set and
 * confidence ≥ threshold, schedule a 5-minute-delayed auto-send (same
 * pattern as the existing high-confidence path). For now we always store
 * the draft and stay in approval queue.
 *
 * Cost: ~$0.003 per draft uncached, ~$0.0002 cached (95% reduction). At
 * 30 leads/week needing LLM that's ~$0.10/week per shop.
 */

import { callOpenRouter } from "@/lib/llm/openrouterClient";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const LLM_MODEL = "anthropic/claude-sonnet-4.5";

export type LlmDraftInput = {
  shopId: string;
  shopName: string;
  shopSlug: string;
  /** Sender first name baked into signature (Ben / Max). */
  senderFirstName: string;
  bookingUrl: string;
  /** Reason the deterministic path bailed. Helps the LLM focus. */
  reason: "low_confidence" | "vehicle_size_unknown" | "notes_present" | "draft_error" | "other";
  /** Lead context the LLM uses to draft. */
  firstName: string;
  serviceRequested: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  customerNotes: string | null;
  /** The deterministic draft, if there was one. The LLM uses it as a starting
   *  point for tone but rewrites freely. */
  deterministicSubject: string;
  deterministicBody: string;
};

export type LlmDraftResult = {
  /** 0.0–1.0 — LLM's own assessment of how confident it is in the quote. */
  confidence: number;
  subject: string;
  body: string;
  /** Plain-text body wrapped in minimal HTML for the email. */
  htmlBody: string;
  /** May be null if the LLM decides to ask for more info instead of quoting. */
  suggestedPriceEstimate: number | null;
  sizeAssumption: "small" | "medium" | "large" | "xl" | null;
  /** Set when LLM thinks we should ask for clarification. The body will be a
   *  polite info-request rather than a quote. */
  needsMoreInfo: string | null;
  internalNotes: string;
  usage: { promptTokens?: number; completionTokens?: number };
};

/**
 * Static system-prompt portion. Cached on Anthropic via cache_control.
 */
const RESPONSE_FRAMEWORK = `You are the customer-quote assistant for Clean Car Collective, a NZ vehicle detailing business. You draft email replies to website enquiries when the deterministic auto-respond can't handle them confidently.

Tone & style:
- Warm, casual, NZ — match the customer's casualness if they were casual.
- Conversational, not corporate. Don't sound like a chatbot.
- NZ English: colour, customise, organise, kerb, neighbour, etc.
- Keep emails short — under 12 short lines. Customers don't read long emails.
- Sign off with the sender's first name + "Clean Car Collective {shop}". The senderFirstName is provided in each request.

What every quote should include:
- A clear price or price range. If unsure on size, give a RANGE and explain why ("roughly $X–$Y depending on the {make/model}'s size").
- One clear next step: book online (URL provided per request), reply with a photo, or reply to confirm.
- Address the customer by their first name.

When to ask for info instead of quoting (set needs_more_info, leave price null):
- Vehicle is genuinely unclear ("car", "my vehicle", obvious typo we can't decode).
- Customer asked for something we don't offer (engine work, mechanical, panel beating).
- Notes contain a complex multi-part request that needs phone discussion.
- Anything where guessing the price would be unprofessional.

Confidence scoring (be honest):
- 0.95+ : clear vehicle, standard service, pricing table covers it cleanly.
- 0.80–0.94 : minor ambiguity but quote is still defensible.
- 0.60–0.79 : meaningful uncertainty, range given, staff should sanity-check before sending.
- <0.60 : we should probably ask for more info instead.

Hard rules:
- Never promise something not in the pricing table.
- Never quote without a price unless needs_more_info is set with the missing piece.
- Never make up services we don't offer.
- For high-value vehicles (Range Rover, Tesla Model S/X, Porsche, etc.) be conservative with the price and flag in internal_notes.
- For very-large jobs (>$1500 estimate) lower confidence to <0.75 — we want a human to glance at it.

Output: ONLY a JSON object with these exact keys:
{
  "confidence": number 0.0-1.0,
  "subject": "string",
  "body": "string with \\n line breaks",
  "suggested_price_estimate": number | null,
  "size_assumption": "small" | "medium" | "large" | "xl" | null,
  "needs_more_info": null | "string explaining what we need",
  "internal_notes": "1-2 sentences for staff explaining your reasoning"
}

No prose. No markdown. No explanation. Just the JSON.`;

type PricingRow = { service_name: string; size: string | null; price_ex_gst: number | null };

async function loadPricingForPrompt(shopId: string): Promise<PricingRow[]> {
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from("pricing")
    .select("service_name, size, price_ex_gst")
    .eq("shop_id", shopId);
  return (data ?? []) as PricingRow[];
}

function formatPricingTable(rows: PricingRow[]): string {
  if (rows.length === 0) return "(no pricing rows on file — be very cautious)";
  // Group by service for readability
  const byService = new Map<string, PricingRow[]>();
  for (const r of rows) {
    const list = byService.get(r.service_name) ?? [];
    list.push(r);
    byService.set(r.service_name, list);
  }
  const lines: string[] = [];
  for (const [service, prices] of byService) {
    lines.push(`${service}:`);
    for (const p of prices) {
      lines.push(`  - ${p.size ?? "any size"}: $${p.price_ex_gst ?? "?"}`);
    }
  }
  return lines.join("\n");
}

/**
 * Build the system prompt with the static framework + per-shop pricing.
 * The whole thing gets `cache_control: ephemeral` so re-invocations within
 * the 5-minute prompt-cache window only pay for the user message.
 */
async function buildSystemPrompt(input: LlmDraftInput): Promise<string> {
  const pricing = await loadPricingForPrompt(input.shopId);
  return [
    RESPONSE_FRAMEWORK,
    "",
    `Shop: ${input.shopName} (slug: ${input.shopSlug})`,
    `Sender first name (use in signature): ${input.senderFirstName}`,
    `Booking URL: ${input.bookingUrl}`,
    "",
    "Current pricing (ex GST):",
    formatPricingTable(pricing),
  ].join("\n");
}

function buildUserPrompt(input: LlmDraftInput): string {
  const lines = [
    "Draft a reply to this enquiry.",
    "",
    "WHY THE DETERMINISTIC SYSTEM BAILED:",
    `  ${input.reason}`,
    "",
    "ENQUIRY:",
    `  Customer: ${input.firstName}`,
    `  Service requested: ${input.serviceRequested ?? "(not specified)"}`,
    `  Vehicle: ${[input.vehicleYear, input.vehicleMake, input.vehicleModel].filter(Boolean).join(" ") || "(not specified)"}`,
  ];
  if (input.customerNotes && input.customerNotes.trim()) {
    lines.push(`  Customer notes: ${input.customerNotes.trim()}`);
  }
  lines.push("");
  if (input.deterministicSubject || input.deterministicBody) {
    lines.push("REFERENCE — what the deterministic system was about to send (you can borrow tone/structure but rewrite freely):");
    lines.push(`Subject: ${input.deterministicSubject}`);
    lines.push("---");
    lines.push(input.deterministicBody);
  }
  return lines.join("\n");
}

function plainTextToHtml(text: string): string {
  // Minimal — wrap paragraphs, preserve line breaks, no fancy styling. The
  // existing HTML email wrapper does the chrome; this is just the body.
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paragraphs
    .map((p) => `<p>${p.replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

export async function llmDraftQuote(input: LlmDraftInput): Promise<LlmDraftResult> {
  const systemPrompt = await buildSystemPrompt(input);
  const userPrompt = buildUserPrompt(input);

  const response = await callOpenRouter({
    model: LLM_MODEL,
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 1200,
    messages: [
      {
        role: "system",
        content: [
          {
            type: "text",
            text: systemPrompt,
            // Cache the entire system prompt (framework + pricing). Per-shop,
            // stable across leads. Cuts cost on every subsequent call.
            cache_control: { type: "ephemeral" },
          },
        ],
      },
      { role: "user", content: userPrompt },
    ],
  });

  // Parse — the model is instructed to return raw JSON. Be defensive.
  let parsed: any;
  try {
    parsed = JSON.parse(response.content);
  } catch {
    // Sometimes models wrap JSON in code fences despite instructions
    const fenced = response.content.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (fenced) parsed = JSON.parse(fenced[1]!);
    else throw new Error(`LLM returned non-JSON: ${response.content.slice(0, 200)}`);
  }

  const subject = String(parsed.subject ?? "");
  const body = String(parsed.body ?? "");
  if (!subject || !body) {
    throw new Error("LLM response missing subject or body");
  }

  return {
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
    subject,
    body,
    htmlBody: plainTextToHtml(body),
    suggestedPriceEstimate:
      typeof parsed.suggested_price_estimate === "number" ? parsed.suggested_price_estimate : null,
    sizeAssumption: ["small", "medium", "large", "xl"].includes(parsed.size_assumption)
      ? parsed.size_assumption
      : null,
    needsMoreInfo: typeof parsed.needs_more_info === "string" && parsed.needs_more_info.trim()
      ? parsed.needs_more_info.trim()
      : null,
    internalNotes: String(parsed.internal_notes ?? "").slice(0, 1000),
    usage: {
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
    },
  };
}
