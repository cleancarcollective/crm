/**
 * Thin wrapper around the OpenRouter chat-completions endpoint.
 * OpenRouter is OpenAI-compatible and proxies to Anthropic models, where
 * we use prompt caching (`cache_control` on the system message) to keep
 * cost low for the static system prompt + pricing table that gets reused
 * across every lead.
 *
 * Why OpenRouter and not the Anthropic SDK directly?
 *   - Single API key works across providers (easy to swap models if needed)
 *   - Cache pass-through is supported for Anthropic models
 *   - Lower friction for the user — already had an OpenRouter key
 *
 * Reference: https://openrouter.ai/docs#cache-control
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

type CacheControl = { type: "ephemeral" };

type TextBlock = {
  type: "text";
  text: string;
  /** Pass cache_control on the static portion of the system prompt to enable
   *  prompt caching on Anthropic models. ~95% input-cost reduction after the
   *  first call. */
  cache_control?: CacheControl;
};

export type LlmMessage =
  | { role: "system"; content: string | TextBlock[] }
  | { role: "user"; content: string | TextBlock[] }
  | { role: "assistant"; content: string };

export type LlmRequest = {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  /** Force JSON output. Anthropic models honour this via OpenRouter. */
  response_format?: { type: "json_object" };
  max_tokens?: number;
};

export type LlmResponse = {
  raw: unknown;
  content: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

export class OpenRouterError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
    this.body = body;
  }
}

export async function callOpenRouter(req: LlmRequest): Promise<LlmResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY env var");

  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // OpenRouter recommends these for telemetry / fairness routing
      "HTTP-Referer": "https://crm.cleancarcollective.co.nz",
      "X-Title": "Clean Car Collective CRM",
    },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new OpenRouterError(
      `OpenRouter ${response.status}: ${text.slice(0, 200)}`,
      response.status,
      text
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  if (!content) {
    throw new OpenRouterError("OpenRouter returned empty content", 200, JSON.stringify(json));
  }
  return { raw: json, content, usage: json.usage };
}
