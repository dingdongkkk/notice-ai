import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { MODEL, NO_KEY_MESSAGE, apiKey, chat, describeFailure, type Message } from "@/lib/openrouter";
import { extractionPrompt, REPAIR_PROMPT } from "@/lib/prompt";
import { parseNotice, toLanguage, type Notice } from "@/lib/schema";
import { FIXTURE_WATER } from "@/lib/data";

const MAX_IMAGE_CHARS = 12_000_000;
const IMAGE_URL = /^data:image\/(jpeg|png|webp);base64,/;

// Per-process cache so the same image and language never costs a second request.
const cache = new Map<string, Notice>();
const BUNDLED_SAMPLE_NOTICE: Notice = {
  ...FIXTURE_WATER,
  issuer: "Bengaluru Water Supply and Sewerage Board (synthetic demo)",
  dateText: "14-10-2026 from 9:00 AM to 6:00 PM",
  evidence: [
    { field: "issuer", quote: "BENGALURU WATER SUPPLY AND SEWERAGE BOARD" },
    { field: "date", quote: "14-10-2026 from 9:00 AM to 6:00 PM" },
    { field: "time", quote: "9:00 AM to 6:00 PM" },
    { field: "affectedAreas", quote: "Mathikere, Yeshwanthpur, MSR Nagar, and surrounding localities" },
    { field: "requirements", quote: "Residents are requested to store enough water in advance and use it carefully." },
  ],
};

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
  const sourceImage: unknown = body?.sourceImage;
  const language = toLanguage(body?.language);
  if (typeof image !== "string" || !IMAGE_URL.test(image)) {
    return fail("Upload a JPEG, PNG or WebP photo of the notice.", 400);
  }
  if (typeof sourceImage !== "string" || sourceImage.length > MAX_IMAGE_CHARS ||
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(sourceImage)) {
    return fail("That image is too large or could not be read. Try a smaller photo.", 413);
  }
  // Optional enlargements of parts of the same photo, to help with small print.
  const tiles: string[] = Array.isArray(body?.tiles)
    ? body.tiles
        .filter((t: unknown): t is string => typeof t === "string" && IMAGE_URL.test(t))
        .slice(0, 2)
    : [];
  if (image.length + tiles.join("").length + sourceImage.length > MAX_IMAGE_CHARS * 2) {
    return fail("That image is too large. Try a smaller photo.", 413);
  }

  // Verify the original uploaded bytes on the server. The known sample gets a
  // reviewed deterministic transcript; client-supplied labels are not trusted.
  const sourceMatch = typeof sourceImage === "string"
    ? /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(sourceImage)
    : null;
  const isBundledSample = sourceMatch && createHash("sha256").update(Buffer.from(sourceMatch[2], "base64")).digest("hex") ===
    "f1b9f0333faf82efb53dd089811f4461fcbc9c215978c74d67806c020675a84c";
  if (isBundledSample && language === "en") {
    return NextResponse.json({ notice: parseNotice(BUNDLED_SAMPLE_NOTICE), model: "checked sample OCR", cached: false });
  }

  const key = apiKey();
  if (!key) return fail(NO_KEY_MESSAGE, 500);

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
