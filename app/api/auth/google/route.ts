import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { googleConfig } from "@/lib/auth";

// Starts Google sign-in: remembers a random value in a short-lived cookie and
// sends the browser to Google, which must send the same value back.
export async function GET(req: Request) {
  const config = googleConfig(req);
  if (!config) return NextResponse.redirect(new URL("/login?error=google-setup", req.url));

  const state = randomBytes(24).toString("hex");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString();

  const res = NextResponse.redirect(url);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.headers.append(
    "Set-Cookie",
    `nta_oauth=${state}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
  );
  return res;
}
