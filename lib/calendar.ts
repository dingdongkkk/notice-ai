import { isIsoDate, isTime } from "./schema";

// Adds a reminder to the person's own Google Calendar. Permission is asked for
// each time in a small Google window, the event is written straight away, and
// the access Google grants is thrown away afterwards: no tokens are stored.

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_COOKIE = "nta_cal";
const EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const REMIND_MINUTES = 12 * 60;

export type CalendarRequest = {
  title: string;
  description: string;
  location: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  // Set when a reminder for the same notice was added before, to update it.
  eventId: string | null;
};

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function parseCalendarRequest(body: unknown): CalendarRequest | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const date = typeof b.date === "string" ? b.date : null;
  if (!isIsoDate(date)) return null;
  const startTime = typeof b.startTime === "string" && isTime(b.startTime) ? b.startTime : null;
  const endTime =
    startTime && typeof b.endTime === "string" && isTime(b.endTime) && b.endTime > startTime
      ? b.endTime
      : null;
  const eventId =
    typeof b.eventId === "string" && /^[a-zA-Z0-9_-]{5,200}$/.test(b.eventId) ? b.eventId : null;
  return {
    title: text(b.title, 200) || "Public notice",
    description: text(b.description, 1500),
    location: text(b.location, 300),
    date,
    startTime,
    endTime,
    eventId,
  };
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function eventBody(r: CalendarRequest) {
  const when = r.startTime
    ? {
        start: { dateTime: `${r.date}T${r.startTime}:00`, timeZone: "Asia/Kolkata" },
        end: { dateTime: `${r.date}T${r.endTime ?? r.startTime}:00`, timeZone: "Asia/Kolkata" },
      }
    : { start: { date: r.date }, end: { date: nextDay(r.date) } };
  return {
    summary: r.title,
    description: `${r.description}\n\nCreated from a photo of a notice by Notice → Action. Check the original notice.`.trim(),
    location: r.location || undefined,
    ...when,
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: REMIND_MINUTES }] },
  };
}

export type CalendarResult =
  | { ok: true; eventId: string; link: string | null; updated: boolean }
  | { ok: false };

export async function writeEvent(accessToken: string, r: CalendarRequest): Promise<CalendarResult> {
  const send = (method: "POST" | "PATCH", url: string) =>
    fetch(url, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(eventBody(r)),
      signal: AbortSignal.timeout(15_000),
    });
  try {
    let updated = false;
    let res: Response | null = null;
    if (r.eventId) {
      res = await send("PATCH", `${EVENTS}/${encodeURIComponent(r.eventId)}`);
      updated = res.ok;
    }
    // No earlier event, or it was deleted from the calendar: add a new one.
    if (!res || !res.ok) res = await send("POST", EVENTS);
    if (!res.ok) return { ok: false };
    const event = await res.json();
    if (typeof event?.id !== "string") return { ok: false };
    return {
      ok: true,
      eventId: event.id,
      link: typeof event.htmlLink === "string" ? event.htmlLink : null,
      updated,
    };
  } catch {
    return { ok: false };
  }
}

// The page shown in the small Google window when it comes back. It tells the
// main page what happened and closes itself.
export function resultPage(result: CalendarResult): string {
  const data = JSON.stringify({ type: "nta-calendar", ...result }).replace(/</g, "\\u003c");
  const message = result.ok
    ? "Added to your Google Calendar. You can close this window."
    : "The reminder could not be added. You can close this window and use the calendar file instead.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Notice → Action</title></head>
<body style="font-family: system-ui, sans-serif; padding: 2rem; font-size: 1.1rem; line-height: 1.5">
<p>${message}</p>
<script>
  try { new BroadcastChannel("nta-calendar").postMessage(${data}); } catch (e) {}
  setTimeout(function () { window.close(); }, 600);
</script>
</body></html>`;
}
