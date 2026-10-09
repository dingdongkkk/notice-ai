import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import {
  addToLibrary,
  canShare,
  deleteDocument,
  listDocuments,
  saveDocument,
} from "@/lib/retrieve";
import { parseNotice, toLanguage, type Notice } from "@/lib/schema";

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

const SIGN_IN = "Sign in to use your saved notices.";

export async function GET(req: Request) {
  const user = currentUser(req);
  if (!user) return fail(SIGN_IN, 401);
  return NextResponse.json({ documents: listDocuments(user.id) });
}

// Saves the facts read from a notice to the signed-in person's account. The
// photo is never sent here. With `share`, a non-personal summary of a public
// notice is also added to the shared library.
export async function POST(req: Request) {
  const user = currentUser(req);
  if (!user) return fail(SIGN_IN, 401);
  const body = await req.json().catch(() => null);
  let notice: Notice;
  try {
    notice = parseNotice(body?.notice);
  } catch {
    return fail("The notice data was not valid.", 400);
  }
  const id = await saveDocument(user.id, notice, toLanguage(body?.language));
  const shared = body?.share === true && canShare(notice) ? addToLibrary(notice, "user") : false;
  return NextResponse.json({ id, shared });
}

export async function DELETE(req: Request) {
  const user = currentUser(req);
  if (!user) return fail(SIGN_IN, 401);
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || !deleteDocument(user.id, id)) return fail("Notice not found.", 404);
  return NextResponse.json({ deleted: id });
}
