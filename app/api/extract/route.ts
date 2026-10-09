import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { MODEL, NO_KEY_MESSAGE, apiKey, chat, describeFailure, type Message } from "@/lib/openrouter";
import { extractionPrompt, REPAIR_PROMPT } from "@/lib/prompt";
import { parseNotice, toLanguage, type Notice } from "@/lib/schema";

const MAX_IMAGE_CHARS = 12_000_000;
const IMAGE_URL = /^data:image\/(jpeg|png|webp);base64,/;

// Per-process cache so the same image and language never costs a second request.
const cache = new Map<string, Notice>();

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function toNotice(content: string): Notice {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object");
  return parseNotice(JSON.parse(content.slice(start, end + 1)));
}

export async function POST(req: Request) {
  const key = apiKey();
  if (!key) return fail(NO_KEY_MESSAGE, 500);

  const body = await req.json().catch(() => null);
  const image: unknown = body?.image;
  const language = toLanguage(body?.language);
  if (typeof image !== "string" || !IMAGE_URL.test(image)) {
    return fail("Upload a JPEG, PNG or WebP photo of the notice.", 400);
  }
  // Optional enlargements of parts of the same photo, to help with small print.
  const tiles: string[] = Array.isArray(body?.tiles)
    ? body.tiles
        .filter((t: unknown): t is string => typeof t === "string" && IMAGE_URL.test(t))
        .slice(0, 2)
    : [];
  if (image.length + tiles.join("").length > MAX_IMAGE_CHARS) {
    return fail("That image is too large. Try a smaller photo.", 413);
  }

  const cacheKey = createHash("sha256").update(`${MODEL}|${language}|${image}|${tiles.join("|")}`).digest("hex");
  const cached = cache.get(cacheKey);
  if (cached) return NextResponse.json({ notice: cached, model: MODEL, cached: true });

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const messages: Message[] = [
    {
      role: "user",
      content: [
        { type: "text", text: extractionPrompt(language, today, tiles.length) },
        { type: "image_url", image_url: { url: image } },
        ...tiles.map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    },
  ];

  try {
    const first = await chat(messages, key, 2600);
    let notice: Notice;
    try {
      notice = toNotice(first);
    } catch {
      // One bounded repair request, then give up visibly.
      const second = await chat(
        [...messages, { role: "assistant", content: first }, { role: "user", content: REPAIR_PROMPT }],
        key,
        2600,
      );
      try {
        notice = toNotice(second);
      } catch {
        return fail(
          "The model's answer could not be read as structured data. Try again or retake the photo.",
          502,
        );
      }
    }
    cache.set(cacheKey, notice);
    return NextResponse.json({ notice, model: MODEL, cached: false });
  } catch (err) {
    const { error, status } = describeFailure(err);
    return fail(error, status);
  }
}
