/**
 * LLM-backed vehicle sizing fallback.
 *
 * The deterministic MODEL_DB only covers ~120 common NZ models. When a
 * customer enquires about something outside that list (Porsche, Tesla,
 * Lexus, lots of trucks, etc.), the deterministic classifier returns
 * null and the lead lands in needs_approval. The old Google-Sheets
 * automation apparently did a web lookup for size; this module does
 * the equivalent via Claude.
 *
 * Approach: small JSON-only prompt with the 4 size categories defined,
 * one user message with make/model/year. Returns a size + confidence.
 * Cost: ~$0.0005 per call uncached, ~$0.0001 cached after the first.
 *
 * Failures are non-fatal — caller falls back to needs_approval with
 * Medium-rendered draft, same as before this module existed.
 */

import { callOpenRouter } from "@/lib/llm/openrouterClient";

import { recordVehicleSizeToCache } from "./vehicleSizeCache";
import type { VehicleSize } from "./vehicleSizing";

const LLM_MODEL = "anthropic/claude-sonnet-4.5";

const SYSTEM_PROMPT = `You classify vehicles into a size category for car-detailing pricing in New Zealand. Four categories only:

- Small: superminis, small hatches, AND 2-door sports cars / 2-seater coupes (Toyota Yaris, VW Polo, Suzuki Swift, Mini Cooper, Mazda 2, Toyota 86/GR86, Mazda MX-5, Subaru BRZ, Nissan Z, Porsche 911, Porsche Cayman/Boxster, Audi TT)
- Medium: sedans, small SUVs, hot hatches, larger GT/muscle coupes (Toyota Corolla, Honda Civic, BMW 3 Series, Mazda CX-3, VW Golf, Ford Mustang, Tesla Model 3)
- Large: full-size SUVs, wagons, large sedans, executive cars (Toyota RAV4, Subaru Outback, BMW X5, Mercedes E-Class, Tesla Model Y, Volvo XC60)
- XL: utes/pickups, vans, 7-seaters, full-size SUVs (Ford Ranger, Toyota Hilux, Toyota Hiace, Land Cruiser, Tesla Model X, Range Rover, Toyota Alphard)

2-door sports cars and 2-seater coupes are Small — they're physically small with minimal interior, so there's less to detail (e.g. Porsche 911 Turbo S, Toyota 86, Mazda MX-5 are all Small). Only big GT/muscle coupes and 2+2s with real back seats (Mustang, BMW 4 Series) are Medium.
IMPORTANT: a "Turbo S" or "Turbo" badge on a Porsche defaults to the 911 (Small) UNLESS the model clearly says Cayenne (Large), Panamera (Large), or Macan (Large) — those are SUVs/sedans.
Classic and pre-1990 cars: use modern equivalent body type.

Return ONLY a JSON object:
{
  "size": "Small" | "Medium" | "Large" | "XL",
  "confidence": 0.0-1.0,
  "rationale": "one short sentence"
}

confidence >= 0.85 means you're sure (real model, common knowledge).
confidence 0.6-0.84 means you've inferred from limited info.
confidence < 0.6 means you really don't know — pick Medium as the safest default and explain why.`;

export type LlmSizeResult = {
  size: VehicleSize;
  confidence: number;
  rationale: string;
  usage?: { promptTokens?: number; completionTokens?: number };
};

export async function classifyVehicleViaLlm(
  makeRaw: string,
  modelRaw: string,
  yearRaw: string | null
): Promise<LlmSizeResult | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;
  if (!makeRaw && !modelRaw) return null;

  const userPrompt = [
    `Make: ${makeRaw || "(unknown)"}`,
    `Model: ${modelRaw || "(unknown)"}`,
    yearRaw ? `Year: ${yearRaw}` : null,
  ]
    .filter(Boolean)
    .join("\n");

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

    let parsed: any;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      const fenced = response.content.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
      if (!fenced) return null;
      parsed = JSON.parse(fenced[1]!);
    }

    const validSizes: VehicleSize[] = ["Small", "Medium", "Large", "XL"];
    if (!validSizes.includes(parsed.size)) return null;

    const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 200) : "";

    // Persist to the cache so the next enquiry for this vehicle skips
    // the LLM call. Only store reasonably confident verdicts — sub-0.6
    // results are caller-rejected anyway and we don't want low-quality
    // guesses cementing in the cache. Non-blocking.
    if (confidence >= 0.6) {
      void recordVehicleSizeToCache({
        makeRaw,
        modelRaw,
        size: parsed.size,
        confidence,
        source: "llm",
        rationale,
      });
    }

    return {
      size: parsed.size,
      confidence,
      rationale,
      usage: {
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
      },
    };
  } catch (err) {
    console.warn("classifyVehicleViaLlm failed (non-fatal)", err instanceof Error ? err.message : err);
    return null;
  }
}
