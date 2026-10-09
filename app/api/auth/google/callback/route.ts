import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { googleConfig, sessionCookie, startSession, userForGoogle } from "@/lib/auth";

const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

function sameValue(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Google sends the browser back here with a one-time code. The server swaps
// it for an identity, checks that identity was issued to this app, and starts
// a session.
export async function GET(req: Request) {
  const failed = (reason = "google") => {
    const res = NextResponse.redirect(new URL(`/login?error=${reason}`, req.url));
    res.headers.append("Set-Cookie", "nta_oauth=; Path=/api/auth/google; HttpOnly; Max-Age=0");
    return res;
  };

  const config = googleConfig(req);
  if (!config) return failed("google-setup");

  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const cookie = (req.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .find((part) => part.startsWith("nta_oauth="))
    ?.slice("nta_oauth=".length);
  if (!code || !state || !cookie || !sameValue(state, cookie)) return failed();

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || typeof tokens?.id_token !== "string") return failed();

    // The identity token comes straight from Google over HTTPS, so its claims
    // are read directly and then checked against this app.
    const claims = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString());
    if (
      claims.aud !== config.clientId ||
      !ISSUERS.includes(claims.iss) ||
      Number(claims.exp) * 1000 < Date.now() ||
      typeof claims.sub !== "string" ||
      typeof claims.email !== "string" ||
      claims.email_verified !== true
    ) {
      return failed();
    }

    const user = userForGoogle(claims.sub, claims.email);
    const res = NextResponse.redirect(new URL("/", req.url));
    res.headers.append("Set-Cookie", sessionCookie(startSession(user)));
    res.headers.append("Set-Cookie", "nta_oauth=; Path=/api/auth/google; HttpOnly; Max-Age=0");
    return res;
  } catch {
    return failed();
  }
}
