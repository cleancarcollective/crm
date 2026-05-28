/**
 * LLM judge for customer-supplied notes.
 *
 * The auto-respond flow used to send any lead with non-empty notes to
 * needs_approval — defensible but too aggressive. ~60% of "notes" leads
 * are info-only ("RAV4 2019, has dog hair", "auckland trip on Friday")
 * that the deterministic template already handles correctly. Those
 * shouldn't block auto-send.
 *
 * This module asks Claude to decide:
 *   - auto_ok: the notes are descriptive context only (vehicle details,
 *     mild condition info, scheduling preferences we don't act on, etc.)
 *     -> safe to auto-send the deterministic estimate.
 *   - human_needed: the notes contain a specific question, a request
 *     outside our standard menu, a complaint, a budget constraint, or
 *     anything that needs a human reply -> needs_approval.
 *
 * Conservative bias: when in doubt, choose human_needed. False positives
 * (escalating an auto-ok note) just delay; false negatives (auto-sending
 * a quote that ignores a real question) damage trust.
 *
 * Cost: ~$0.0005 per call. Failure is non-fatal — caller falls back to
 * the legacy "any notes -> needs_approval" behaviour.
 */

import { callOpenRouter } from "@/lib/llm/openrouterClient";

const LLM_MODEL = "anthropic/claude-sonnet-4.5";

const SYSTEM_PROMPT = `You are triaging customer enquiry notes for a car detailing business in New Zealand. The customer has filled out a booking form: name, vehicle, service. They've optionally left additional notes.

Your job: decide whether the auto-generated estimate email (which contains greeting, pricing for their service, and a booking link) can safely send AS-IS, or whether a human needs to review and reply.

Return ONLY a JSON object:
{
  "verdict": "auto_ok" | "human_needed",
  "confidence": 0.0-1.0,
  "rationale": "one short sentence"
}

Choose "auto_ok" when notes are:
- Pure vehicle description (color, year, "white sedan", "manual", "dog hair", "needs interior detail")
- Mild condition info that doesn't change pricing ("a bit dirty", "lots of dust", "haven't cleaned it in ages")
- Mentioning location they already gave on the form
- Generic enthusiasm ("looking forward to it", "first time", "heard good things")
- Empty-ish ("n/a", "none", "thanks", "-")

Choose "human_needed" when notes contain:
- A specific question ("can you do paint correction?", "do you come to Lyttelton?", "how long does it take?")
- A request for service NOT on the standard menu (paint correction, ceramic coating add-on, headlight restoration, engine bay, pet hair removal as a SEPARATE charge, etc.)
- A budget constraint or price challenge ("I only have $200", "is there a cheaper option?")
- A timing/availability constraint that needs confirmation ("must be done before Friday", "I leave for Aussie on the 20th")
- A complaint, prior bad experience, or comparison shopping ("the last place did X for Y")
- Insurance, accident damage, mould, smoke, severe stain, vomit, or anything implying heavy condition that may require an inspection or higher quote
- ANY ambiguity where you're not certain auto-send is safe

When uncertain, choose "human_needed". Confidence below 0.7 should also default to "human_needed".`;

export type NotesVerdict = {
  verdict: "auto_ok" | "human_needed";
  confidence: number;
  rationale: string;
  usage?: { promptTokens?: number; completionTokens?: number };
};

export async function judgeCustomerNotes(args: {
  notes: string;
  serviceRequested: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
}): Promise<NotesVerdict | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;
  const trimmed = (args.notes || "").trim();
  if (!trimmed) return null;

  const userPrompt = [
    `Service requested: ${args.serviceRequested ?? "(not given)"}`,
    `Vehicle: ${[args.vehicleMake, args.vehicleModel].filter(Boolean).join(" ") || "(not given)"}`,
    "Customer notes:",
    trimmed,
  ].join("\n");

  try {
    const response = await callOpenRouter({
      model: LLM_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: [
            { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
          ],
        },
        { role: "user", content: userPrompt },
      ],
    });

    let parsed: { verdict?: string; confidence?: number; rationale?: string };
    try {
      parsed = JSON.parse(response.content);
    } catch {
      const fenced = response.content.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
      if (!fenced) return null;
      parsed = JSON.parse(fenced[1]!);
    }

    if (parsed.verdict !== "auto_ok" && parsed.verdict !== "human_needed") return null;

    return {
      verdict: parsed.verdict,
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 200) : "",
      usage: {
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
      },
    };
  } catch (err) {
    console.warn("judgeCustomerNotes failed (non-fatal)", err instanceof Error ? err.message : err);
    return null;
  }
}
