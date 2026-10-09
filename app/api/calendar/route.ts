import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { googleConfig } from "@/lib/auth";
import { CALENDAR_COOKIE, CALENDAR_SCOPE, parseCalendarRequest } from "@/lib/calendar";

// Starts adding a reminder to Google Calendar. The reminder is held in a
// short-lived cookie while the person approves access in a Google window; the
// sign-in callback then writes the event (see lib/calendar.ts).
export async function POST(req: Request) {
  const config = googleConfig(req);
  if (!config) {
    return NextResponse.json({ error: "Google Calendar is not set up on this server." }, { status: 503 });
  }
  const request = parseCalendarRequest(await req.json().catch(() => null));
  if (!request) {
    return NextResponse.json({ error: "A confirmed date is needed for a reminder." }, { status: 400 });
  }

  const state = `cal_${randomBytes(24).toString("hex")}`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    state,
    include_granted_scopes: "true",
  }).toString();

  const payload = Buffer.from(JSON.stringify(request)).toString("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const res = NextResponse.json({ url: url.toString() });
  res.headers.append(
    "Set-Cookie",
    `${CALENDAR_COOKIE}=${state}.${payload}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
  );
  return res;
}
