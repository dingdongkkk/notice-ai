const TIMEOUT_MS = 90_000;

// Two hosts can serve Gemma 4. A Google AI Studio key takes priority when both
// are set. Google is called through its own API so that the model's thinking
// can be switched off; OpenRouter uses the chat-completions shape.
type Provider = { name: "Google AI Studio" | "OpenRouter"; endpoint: string; key: string; model: string };

function pickProvider(): Provider | null {
  const google = process.env.GEMINI_API_KEY;
  if (google && google !== "your_key_here") {
    return {
      name: "Google AI Studio",
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
      key: google,
      // The 26B model answered in a few seconds in testing; 31B took up to a minute.
      model: process.env.GEMINI_MODEL || "gemma-4-26b-a4b-it",
    };
  }
  const openrouter = process.env.OPENROUTER_API_KEY;
  if (openrouter && openrouter !== "your_key_here") {
    return {
      name: "OpenRouter",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      key: openrouter,
      model: process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free",
    };
  }
  return null;
}

const PROVIDER = pickProvider();

export const MODEL = PROVIDER?.model ?? "gemma-4-26b-a4b-it";

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
  return PROVIDER?.key ?? null;
}

export const NO_KEY_MESSAGE =
  "No API key is set on the server. Add GEMINI_API_KEY or OPENROUTER_API_KEY to .env.local and restart.";

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

// Converts chat-completions messages to Google's request body.
function googleBody(messages: Message[], maxTokens: number) {
  return {
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: (typeof m.content === "string"
        ? [{ type: "text", text: m.content } as Part]
        : (m.content as Part[])
      ).map((part) => {
        if (part.type === "text") return { text: part.text };
        const [, mimeType, data] = /^data:([^;]+);base64,(.*)$/.exec(part.image_url.url) ?? [];
        return { inlineData: { mimeType, data } };
      }),
    })),
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.1,
      thinkingConfig: { thinkingLevel: "minimal" },
    },
  };
}

export async function chat(messages: Message[], key: string, maxTokens: number): Promise<string> {
  if (!PROVIDER) throw new ProviderError(NO_KEY_MESSAGE, 500);
  const google = PROVIDER.name === "Google AI Studio";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      google ? `${PROVIDER.endpoint}/${PROVIDER.model}:generateContent` : PROVIDER.endpoint,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(google ? { "x-goog-api-key": key } : { Authorization: `Bearer ${key}` }),
        },
        body: JSON.stringify(
          google
            ? googleBody(messages, maxTokens)
            : { model: PROVIDER.model, messages, max_tokens: maxTokens, temperature: 0.1 },
        ),
      },
    );
    const body = await res.json().catch(() => null);
    if (google && res.ok && !body?.error) {
      const candidate = body?.candidates?.[0];
      if (candidate?.finishReason === "MAX_TOKENS") {
        throw new ProviderError("The model's answer was cut off.", 502);
      }
      // Leave out any "thought" parts; only the answer is returned.
      const text = (candidate?.content?.parts ?? [])
        .filter((part: { thought?: boolean }) => !part.thought)
        .map((part: { text?: string }) => part.text ?? "")
        .join("");
      if (!text.trim()) throw new ProviderError("The model returned an empty answer.", 502);
      return text;
    }
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
            ? `The Gemma 4 service is rate limited. Try again in about ${Math.ceil(wait)} seconds.`
            : "The Gemma 4 service is rate limited. Wait a minute and try again.",
        status: 429,
      };
    }
    if (err.status === 503) {
      return { error: "The Gemma 4 service is busy right now. Wait a moment and try again.", status: 503 };
    }
    if (err.status === 400 && /API key/i.test(err.message)) {
      return { error: `${PROVIDER?.name ?? "The provider"} rejected the API key. Check .env.local.`, status: 502 };
    }
    if (err.status === 401 || err.status === 403) {
      return { error: `${PROVIDER?.name ?? "The provider"} rejected the API key. Check .env.local.`, status: 502 };
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
