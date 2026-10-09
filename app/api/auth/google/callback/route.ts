import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { googleConfig, sessionCookie, startSession, userForGoogle } from "@/lib/auth";
import { CALENDAR_COOKIE, parseCalendarRequest, resultPage, writeEvent } from "@/lib/calendar";

const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

function sameValue(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookieValue(req: Request, name: string): string | undefined {
  return (req.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

// A reminder being added to Google Calendar returns through this same address
// so that only one redirect URI has to be registered with Google. It writes
// the event and shows a small page that reports back and closes.
async function finishCalendar(req: Request, config: NonNullable<ReturnType<typeof googleConfig>>) {
  const page = (result: Parameters<typeof resultPage>[0]) => {
    const res = new NextResponse(resultPage(result), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
    res.headers.append("Set-Cookie", `${CALENDAR_COOKIE}=; Path=/api/auth/google; HttpOnly; Max-Age=0`);
    return res;
  };
  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const state = params.get("state") ?? "";
  const [savedState, payload] = (cookieValue(req, CALENDAR_COOKIE) ?? "").split(".");
  if (!code || !savedState || !payload || !sameValue(state, savedState)) return page({ ok: false });

  let request;
  try {
    request = parseCalendarRequest(JSON.parse(Buffer.from(payload, "base64url").toString()));
  } catch {
    request = null;
  }
  if (!request) return page({ ok: false });

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
    if (!tokenRes.ok || typeof tokens?.access_token !== "string") return page({ ok: false });
    // The access token is used for this one request and not kept.
    return page(await writeEvent(tokens.access_token, request));
  } catch {
    return page({ ok: false });
  }
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
  if ((params.get("state") ?? "").startsWith("cal_")) return finishCalendar(req, config);
  const code = params.get("code");
  const state = params.get("state");
  const cookie = cookieValue(req, "nta_oauth");
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
