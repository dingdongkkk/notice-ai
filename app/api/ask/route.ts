import { NextResponse } from "next/server";
import { MODEL, NO_KEY_MESSAGE, apiKey, chat, describeFailure } from "@/lib/openrouter";
import { questionPrompt } from "@/lib/prompt";
import { parseNotice, toLanguage, type Notice } from "@/lib/schema";

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

// Follow-up questions are answered from the validated facts only, not the image.
export async function POST(req: Request) {
  const key = apiKey();
  if (!key) return fail(NO_KEY_MESSAGE, 500);

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 300) {
    return fail("Ask a question of up to 300 characters.", 400);
  }
  let notice: Notice;
  try {
    notice = parseNotice(body?.notice);
  } catch {
    return fail("The notice data was not valid.", 400);
  }

  try {
    const answer = await chat(
      [{ role: "user", content: questionPrompt(notice, question, toLanguage(body?.language)) }],
      key,
      400,
    );
    return NextResponse.json({ answer: answer.trim(), model: MODEL });
  } catch (err) {
    const { error, status } = describeFailure(err);
    return fail(error, status);
  }
}
