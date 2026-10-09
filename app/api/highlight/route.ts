import { NextResponse } from "next/server";
import { NO_KEY_MESSAGE, apiKey, chat, describeFailure } from "@/lib/openrouter";
import { HIGHLIGHT_PROMPT } from "@/lib/prompt";
import { findBoxes, fingerprint, saveBoxes } from "@/lib/readings";

const LABELS = ["date", "time", "areas", "amount", "office", "documents", "action", "consequence", "reference"];

export type Box = { label: string; top: number; left: number; height: number; width: number };

// Asks Gemma 4 where the important parts are written on the page, and returns
// them as percentages of the image so they can be drawn over the photo.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const image: unknown = body?.image;
  if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
    return NextResponse.json({ error: "Upload a JPEG, PNG or WebP photo." }, { status: 400 });
  }
  const hash = fingerprint(image);
  const kept = hash ? findBoxes(hash) : null;
  if (kept) return NextResponse.json({ boxes: kept });

  const key = apiKey();
  if (!key) return NextResponse.json({ error: NO_KEY_MESSAGE }, { status: 500 });

  try {
    const reply = await chat(
      [
        {
          role: "user",
          content: [
            { type: "text", text: HIGHLIGHT_PROMPT },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      key,
      1600,
    );
    const start = reply.indexOf("[");
    const end = reply.lastIndexOf("]");
    const raw: unknown = start >= 0 && end > start ? JSON.parse(reply.slice(start, end + 1)) : [];
    const boxes: Box[] = [];
    for (const item of Array.isArray(raw) ? raw : []) {
      // The model names the coordinates "box_2d" or sometimes just "box".
      const coords = item?.box_2d ?? item?.box;
      if (!LABELS.includes(item?.label) || !Array.isArray(coords) || coords.length !== 4) continue;
      const [y1, x1, y2, x2] = coords.map(Number);
      if (![y1, x1, y2, x2].every((v) => Number.isFinite(v) && v >= 0 && v <= 1000)) continue;
      if (y2 <= y1 || x2 <= x1) continue;
      boxes.push({
        label: item.label,
        top: y1 / 10,
        left: x1 / 10,
        height: (y2 - y1) / 10,
        width: (x2 - x1) / 10,
      });
    }
    const found = boxes.slice(0, 30);
    if (hash && found.length > 0) saveBoxes(hash, found);
    return NextResponse.json({ boxes: found });
  } catch (err) {
    if (err instanceof SyntaxError) return NextResponse.json({ boxes: [] });
    const { error, status } = describeFailure(err);
    return NextResponse.json({ error }, { status });
  }
}
