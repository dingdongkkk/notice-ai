const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 90_000;

export const MODEL = process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";

export type Message = { role: "user" | "assistant"; content: unknown };

class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: string | null,
  ) {
    super(message);
  }
}

export function apiKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY;
  return key && key !== "your_key_here" ? key : null;
}

export const NO_KEY_MESSAGE =
  "OPENROUTER_API_KEY is not set on the server. Add it to .env.local and restart.";

export async function chat(messages: Message[], key: string, maxTokens: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "Notice to Action",
      },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: 0.1 }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.error) {
      const status = res.ok ? Number(body?.error?.code) || 502 : res.status;
      throw new ProviderError(
        body?.error?.message || `Provider returned ${res.status}`,
        status,
        res.headers.get("retry-after"),
      );
    }
    const choice = body?.choices?.[0];
    if (choice?.finish_reason === "length") {
      throw new ProviderError("The model's answer was cut off.", 502);
    }
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new ProviderError("The model returned an empty answer.", 502);
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

// Turns any failure into a message the user can act on. Never a made-up result.
export function describeFailure(err: unknown): { error: string; status: number } {
  if (err instanceof ProviderError) {
    if (err.status === 429) {
      const wait = Number(err.retryAfter);
      return {
        error:
          Number.isFinite(wait) && wait > 0
            ? `The free Gemma endpoint is rate limited. Try again in about ${Math.ceil(wait)} seconds.`
            : "The free Gemma endpoint is rate limited. Wait a minute and try again.",
        status: 429,
      };
    }
    if (err.status === 401 || err.status === 403) {
      return { error: "OpenRouter rejected the API key. Check OPENROUTER_API_KEY.", status: 502 };
    }
    return { error: `The model provider failed: ${err.message}`, status: 502 };
  }
  if (err instanceof Error && err.name === "AbortError") {
    return { error: "The model took too long to answer. Try again.", status: 504 };
  }
  return {
    error: "Could not reach the model provider. Check the connection and try again.",
    status: 502,
  };
}
