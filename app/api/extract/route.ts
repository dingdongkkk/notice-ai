import { NextResponse } from "next/server";
import { MODEL, NO_KEY_MESSAGE, apiKey, chat, describeFailure, type Message } from "@/lib/openrouter";
import { extractionPrompt, REPAIR_PROMPT } from "@/lib/prompt";
import { findReading, fingerprint, saveReading } from "@/lib/readings";
import { parseNotice, toLanguage, type Notice } from "@/lib/schema";

const MAX_IMAGE_CHARS = 12_000_000;
const MAX_ORIGINAL_CHARS = 1_000_000;
const MAX_TOKENS = 4000;
const IMAGE_URL = /^data:image\/(jpeg|png|webp);base64,/;

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

  const original =
    typeof body?.original === "string" && body.original.length <= MAX_ORIGINAL_CHARS
      ? body.original
      : null;
  const hashes = [fingerprint(original), fingerprint(image)].filter((h): h is string => h !== null);
  const kept = findReading(hashes, language);
  if (kept) {
    if (kept.holdSeconds) await new Promise((done) => setTimeout(done, kept.holdSeconds! * 1000));
    return NextResponse.json({ notice: kept.notice, model: kept.model });
  }

  const key = apiKey();
  if (!key) return fail(NO_KEY_MESSAGE, 500);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const ask = (images: string[]): Message[] => [
    {
      role: "user",
      content: [
        { type: "text", text: extractionPrompt(language, today, images.length - 1) },
        ...images.map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    },
  ];

  try {
    let messages = ask([image, ...tiles]);
    let first: string;
    try {
      first = await chat(messages, key, MAX_TOKENS);
    } catch (err) {
      // The model host sometimes fails or runs on too long, more often with
      // several images. Try once more with the whole photo alone.
      const status = (err as { status?: number }).status;
      if (status !== 500 && status !== 502 && status !== 503) throw err;
      messages = ask([image]);
      first = await chat(messages, key, MAX_TOKENS);
    }
    let notice: Notice;
    try {
      notice = toNotice(first);
    } catch {
      // One bounded repair request, then give up visibly.
      const second = await chat(
        [...messages, { role: "assistant", content: first }, { role: "user", content: REPAIR_PROMPT }],
        key,
        MAX_TOKENS,
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
    saveReading(hashes, language, { notice, model: MODEL });
    return NextResponse.json({ notice, model: MODEL });
  } catch (err) {
    const { error, status } = describeFailure(err);
    return fail(error, status);
  }
}
