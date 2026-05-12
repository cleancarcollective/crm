/**
 * LLM-assisted note-response generator. The deterministic templates handle
 * the bulk of the email (greeting, pricing, sign-off). When a customer
 * leaves notes, this generates ONLY a short paragraph addressing those
 * notes that gets injected into the template body just before the
 * "Please let me know if you have any questions..." line.
 *
 * The LLM does NOT:
 *   - Write greetings (template already says "Hi {{name}}").
 *   - Add signatures or "Clean Car Collective ..." (template handles).
 *   - Rewrite pricing (template has the canonical pricing).
 *   - Mention services we don't offer.
 *
 * The LLM does:
 *   - Acknowledge any specific question/request in the customer's notes.
 *   - Address availability/timing/location questions if asked.
 *   - Clarify what we offer if their request is adjacent but not exact.
 *   - Stay 1-3 sentences max.
 *
 * Cost: ~$0.002 per call uncached, ~$0.0001 cached. Negligible.
 */

import { callOpenRouter } from "@/lib/llm/openrouterClient";

const LLM_MODEL = "anthropic/claude-sonnet-4.5";

export type LlmDraftInput = {
  shopId: string;
  shopName: string;
  shopSlug: string;
  senderFirstName: string;
  bookingUrl: string;
  reason: "low_confidence" | "vehicle_size_unknown" | "notes_present" | "draft_error" | "other";
  firstName: string;
  serviceRequested: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  customerNotes: string | null;
  /** The deterministic-rendered draft. Read for context, NOT rewritten. */
  deterministicSubject: string;
  deterministicBody: string;
};

export type LlmDraftResult = {
  /** 0.0–1.0 — confidence the note-response is appropriate. */
  confidence: number;
  /** Final subject — same as the deterministic subject (LLM doesn't rewrite). */
  subject: string;
  /** Final body — deterministic body with the LLM paragraph injected. */
  body: string;
  /** Same body, minimal HTML wrap. */
  htmlBody: string;
  /** The injected paragraph itself, for logging/audit. */
  noteResponse: string | null;
  /** Always null in this flow — pricing comes from the template. */
  suggestedPriceEstimate: number | null;
  /** Always null in this flow. */
  sizeAssumption: "small" | "medium" | "large" | "xl" | null;
  /** Set if LLM thinks the customer's request needs a phone call / clarification. */
  needsMoreInfo: string | null;
  internalNotes: string;
  usage: { promptTokens?: number; completionTokens?: number };
};

const RESPONSE_FRAMEWORK = `You write SHORT paragraphs that get inserted into pre-written quote emails for Clean Car Collective, a NZ vehicle detailing business.

You are NOT writing the whole email. The template already handles:
- Greeting ("Hi {{name}}")
- Service description + pricing
- Sign-off ("Cheers, Ben/Max")

You are ONLY writing 1-3 sentences that address the customer's specific notes/questions. The paragraph gets injected into the template body just before the closing line. Your output must:

- Be 1-3 short sentences. Max.
- NEVER include a greeting (no "Hi", no "Hey").
- NEVER include a signature, sign-off, or the words "Clean Car Collective" anywhere.
- NEVER include URLs, links, or domains of any kind. If the customer wants to book or take action, say "reply to this email". Do NOT direct them to a website. (Links push us into the promotions folder.)
- NEVER use em dashes ( — ). Use commas, periods, or hyphens ( - ) instead. Em dashes look AI-generated.
- NEVER repeat pricing — the template already shows it.
- NEVER mention services we don't offer (we ONLY do: detailing, paint correction, ceramic coatings, paint protection film). If the customer asked for something else (engine bay, panel beating, mechanical, etc.), politely note we don't offer it.
- Use NZ English (colour, customise, etc.) and a warm casual tone.
- Address whatever the customer actually asked.

If the customer's notes contain a question we can't confidently answer (specific timing/availability, complex multi-part request, custom pricing), set needs_more_info to flag it and write a paragraph that gently invites them to reply or call.

Output: ONLY a JSON object with these exact keys:
{
  "confidence": number 0.0-1.0,
  "paragraph": "the 1-3 sentence response to insert",
  "needs_more_info": null | "string explaining what we need",
  "internal_notes": "1 sentence for staff explaining your reasoning"
}

No prose. No markdown fences. Just the JSON.`;

/**
 * Build the per-shop system prompt. Smaller now that we're only writing
 * paragraphs — no pricing table needed (template has prices), no
 * signature instructions (template has them).
 */
async function buildSystemPrompt(input: LlmDraftInput): Promise<string> {
  return [
    RESPONSE_FRAMEWORK,
    "",
    `Shop: ${input.shopName} (slug: ${input.shopSlug})`,
  ].join("\n");
}


function buildUserPrompt(input: LlmDraftInput): string {
  const lines = [
    "Write the paragraph to inject into the template below.",
    "",
    "CUSTOMER:",
    `  Name: ${input.firstName}`,
    `  Service requested: ${input.serviceRequested ?? "(not specified)"}`,
    `  Vehicle: ${[input.vehicleYear, input.vehicleMake, input.vehicleModel].filter(Boolean).join(" ") || "(not specified)"}`,
  ];
  if (input.customerNotes && input.customerNotes.trim()) {
    lines.push(`  Customer notes: ${input.customerNotes.trim()}`);
  } else {
    lines.push(`  Customer notes: (none — return paragraph: "" and confidence: 0)`);
  }
  lines.push("");
  lines.push("TEMPLATE BEING SENT (read for context only — do NOT rewrite, just write the paragraph that will be inserted before the closing 'Please let me know...' line):");
  lines.push(input.deterministicBody);
  return lines.join("\n");
}

function plainTextToHtml(text: string): string {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paragraphs
    .map((p) => `<p>${p.replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

/**
 * Strip any sneaky signatures or brand-name additions the model might still
 * emit despite instructions. Belt-and-braces — we already told it not to,
 * but a single stray "Clean Car Collective" line would slip through if we
 * trusted blindly.
 */
function sanitiseParagraph(p: string): string {
  return p
    .split("\n")
    .filter((line) => {
      const lower = line.toLowerCase().trim();
      if (lower.startsWith("hi ") || lower.startsWith("hey ") || lower.startsWith("hello ")) return false;
      if (lower.startsWith("cheers")) return false;
      if (lower.startsWith("thanks,") || lower === "thanks") return false;
      if (lower.includes("clean car collective")) return false;
      return true;
    })
    .join("\n")
    // Strip any URLs / domains the model snuck in despite instructions.
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/cleancarcollective\.co\.nz\S*/gi, "")
    // Replace em dashes with regular hyphens (em dashes look AI-generated).
    // Use ", " when an em dash was acting as a sentence break, otherwise " - ".
    .replace(/\s*—\s*/g, " - ")
    .replace(/\s*–\s*/g, " - ")
    // Collapse double spaces left by URL stripping
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Insert the LLM paragraph into the deterministic body. We look for the
 * canonical "Please let me know if you have any questions" line and insert
 * before it. If that line isn't found (template variant changed), we
 * insert before the first "Cheers,"/"Thanks," sign-off. If neither, we
 * append before the last paragraph.
 */
function injectParagraph(body: string, paragraph: string): string {
  if (!paragraph) return body;
  const lines = body.split("\n");
  const closingMarkers = [
    /^please let me know/i,
    /^let me know/i,
  ];
  const signatureMarkers = [
    /^cheers,?\s*$/i,
    /^thanks,?\s*$/i,
    /^kind regards/i,
    /^regards,?\s*$/i,
  ];

  // Find first closing-marker line
  let insertAt = lines.findIndex((l) => closingMarkers.some((re) => re.test(l.trim())));
  if (insertAt === -1) {
    insertAt = lines.findIndex((l) => signatureMarkers.some((re) => re.test(l.trim())));
  }
  if (insertAt === -1) {
    // Fallback: just before the last non-empty line
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim()) {
        insertAt = i;
        break;
      }
    }
  }
  if (insertAt < 0) return body + "\n\n" + paragraph;

  const before = lines.slice(0, insertAt).join("\n").replace(/\s+$/, "");
  const after = lines.slice(insertAt).join("\n");
  return `${before}\n\n${paragraph}\n\n${after}`;
}

export async function llmDraftQuote(input: LlmDraftInput): Promise<LlmDraftResult> {
  // Short-circuit: no notes, no need to call the LLM. The template handles
  // everything by itself.
  const hasNotes = !!(input.customerNotes && input.customerNotes.trim());

  if (!hasNotes) {
    return {
      confidence: 1,
      subject: input.deterministicSubject,
      body: input.deterministicBody,
      htmlBody: plainTextToHtml(input.deterministicBody),
      noteResponse: null,
      suggestedPriceEstimate: null,
      sizeAssumption: null,
      needsMoreInfo: null,
      internalNotes: "No customer notes — using template as-is, no LLM call.",
      usage: {},
    };
  }

  const systemPrompt = await buildSystemPrompt(input);
  const userPrompt = buildUserPrompt(input);

  const response = await callOpenRouter({
    model: LLM_MODEL,
    response_format: { type: "json_object" },
    temperature: 0.3,
    max_tokens: 400,
    messages: [
      {
        role: "system",
        content: [
          { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
        ],
      },
      { role: "user", content: userPrompt },
    ],
  });

  let parsed: any;
  try {
    parsed = JSON.parse(response.content);
  } catch {
    const fenced = response.content.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (fenced) parsed = JSON.parse(fenced[1]!);
    else throw new Error(`LLM returned non-JSON: ${response.content.slice(0, 200)}`);
  }

  const rawParagraph = String(parsed.paragraph ?? "").trim();
  const noteResponse = sanitiseParagraph(rawParagraph);

  // Compose final body = template with paragraph injected before sign-off
  const finalBody = noteResponse
    ? injectParagraph(input.deterministicBody, noteResponse)
    : input.deterministicBody;

  return {
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
    subject: input.deterministicSubject,
    body: finalBody,
    htmlBody: plainTextToHtml(finalBody),
    noteResponse: noteResponse || null,
    suggestedPriceEstimate: null,
    sizeAssumption: null,
    needsMoreInfo: typeof parsed.needs_more_info === "string" && parsed.needs_more_info.trim()
      ? parsed.needs_more_info.trim()
      : null,
    internalNotes: String(parsed.internal_notes ?? "").slice(0, 500),
    usage: {
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
    },
  };
}
