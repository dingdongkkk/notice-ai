import { NextResponse } from "next/server";
import { MODEL, NO_KEY_MESSAGE, apiKey, chat, describeFailure } from "@/lib/openrouter";
import { libraryPrompt } from "@/lib/prompt";
import { findInLibrary, libraryStats } from "@/lib/retrieve";
import { toLanguage } from "@/lib/schema";

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET() {
  return NextResponse.json(libraryStats());
}

// Answers a general question about a kind of notice from the shared library,
// so nobody has to upload their own document just to learn what one means.
// No sign-in is needed.
export async function POST(req: Request) {
  const key = apiKey();
  if (!key) return fail(NO_KEY_MESSAGE, 500);
  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 300) return fail("Ask a question of up to 300 characters.", 400);

  const found = await findInLibrary(question);
  try {
    const answer = await chat(
      [
        {
          role: "user",
          content: libraryPrompt(
            found.map((f) => f.entry),
            question,
            toLanguage(body?.language),
          ),
        },
      ],
      key,
      500,
    );
    return NextResponse.json({
      answer: answer.trim(),
      model: MODEL,
      sources: found.map((f, i) => ({
        number: i + 1,
        title: f.entry.title ?? f.entry.documentType ?? "Notice",
        detail: [f.entry.issuer, f.source === "sample" ? "built-in sample" : "shared by a user"]
          .filter(Boolean)
          .join(" · "),
      })),
    });
  } catch (err) {
    const { error, status } = describeFailure(err);
    return fail(error, status);
  }
}
