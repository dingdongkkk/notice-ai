import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { MODEL, NO_KEY_MESSAGE, apiKey, chat, describeFailure } from "@/lib/openrouter";
import { historyPrompt } from "@/lib/prompt";
import { findDocuments } from "@/lib/retrieve";
import { toLanguage } from "@/lib/schema";

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

// Finds the signed-in person's saved notices that best match the question,
// then has Gemma 4 answer from those notices only.
export async function POST(req: Request) {
  const user = currentUser(req);
  if (!user) return fail("Sign in to ask about your saved notices.", 401);
  const key = apiKey();
  if (!key) return fail(NO_KEY_MESSAGE, 500);

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 300) return fail("Ask a question of up to 300 characters.", 400);

  const found = await findDocuments(user.id, question);
  if (found.length === 0) return fail("You have no saved notices yet. Save one first.", 404);

  try {
    const answer = await chat(
      [{ role: "user", content: historyPrompt(found, question, toLanguage(body?.language)) }],
      key,
      500,
    );
    return NextResponse.json({
      answer: answer.trim(),
      model: MODEL,
      sources: found.map((d, i) => ({
        number: i + 1,
        title: d.notice.title ?? d.notice.documentType ?? "Notice",
        detail: [d.notice.issuer, d.notice.eventDate].filter(Boolean).join(" · "),
      })),
    });
  } catch (err) {
    const { error, status } = describeFailure(err);
    return fail(error, status);
  }
}
