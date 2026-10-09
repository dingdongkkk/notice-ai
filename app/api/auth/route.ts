import { NextResponse } from "next/server";
import {
  createUser,
  currentUser,
  endSession,
  sessionCookie,
  signIn,
  startSession,
  validateCredentials,
} from "@/lib/auth";

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET(req: Request) {
  return NextResponse.json({ user: currentUser(req) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === "logout") {
    endSession(req);
    const res = NextResponse.json({ user: null });
    res.headers.set("Set-Cookie", sessionCookie(null));
    return res;
  }

  if (action !== "signup" && action !== "login") return fail("Unknown request.", 400);

  let user;
  if (action === "signup") {
    const problem = validateCredentials(body?.username, body?.password);
    if (problem) return fail(problem, 400);
    user = createUser(body.username, body.password);
    if (!user) return fail("That username is already taken.", 409);
  } else {
    const result = signIn(String(body?.username ?? ""), String(body?.password ?? ""));
    if ("error" in result) return fail(result.error, result.status);
    user = result.user;
  }

  const res = NextResponse.json({ user });
  res.headers.set("Set-Cookie", sessionCookie(startSession(user)));
  return res;
}
