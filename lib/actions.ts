import { isIsoDate, isTime, type Notice } from "./schema";

export type ConfirmedEvent = {
  date: string;
  startTime: string | null;
  endTime: string | null;
};

const esc = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

const compact = (date: string) => date.replace(/-/g, "");

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// IST has no daylight saving, so a fixed +05:30 offset is exact.
function istToUtc(date: string, time: string): string {
  const d = new Date(`${date}T${time}:00+05:30`);
  return d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

export function eventTitle(n: Notice): string {
  return n.title || n.documentType || "Public notice";
}

// Stable per notice so approving twice cannot create a second saved action.
export function eventUid(n: Notice, e: ConfirmedEvent): string {
  const slug = `${n.issuer ?? ""}-${eventTitle(n)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${e.date}-${slug || "notice"}@notice-to-action`;
}

export function buildIcs(n: Notice, e: ConfirmedEvent): string {
  if (!isIsoDate(e.date)) throw new Error("A confirmed date is required.");
  const timed = isTime(e.startTime);
  const end = isTime(e.endTime) && timed && e.endTime > e.startTime! ? e.endTime : null;
  const when = timed
    ? [
        `DTSTART:${istToUtc(e.date, e.startTime!)}`,
        `DTEND:${end ? istToUtc(e.date, end) : istToUtc(e.date, e.startTime!)}`,
      ]
    : [
        `DTSTART;VALUE=DATE:${compact(e.date)}`,
        `DTEND;VALUE=DATE:${compact(nextDay(e.date))}`,
      ];
  const description = [
    n.explanation,
    n.affectedAreas.length ? `Areas: ${n.affectedAreas.join(", ")}` : "",
    "Created from a photo of a notice. Check the original notice.",
  ]
    .filter(Boolean)
    .join("\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Notice to Action//EN",
    "BEGIN:VEVENT",
    `UID:${eventUid(n, e)}`,
    `DTSTAMP:${stamp}`,
    ...when,
    `SUMMARY:${esc(eventTitle(n))}`,
    `DESCRIPTION:${esc(description)}`,
    n.affectedAreas.length ? `LOCATION:${esc(n.affectedAreas.join(", "))}` : "",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(eventTitle(n))}`,
    "TRIGGER:-PT12H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

export function familySummary(n: Notice, e: ConfirmedEvent | null): string {
  const when = e
    ? `${e.date}${e.startTime ? ` ${e.startTime}` : ""}${e.endTime ? `–${e.endTime}` : ""}`
    : "date not confirmed, check the notice";
  return [
    `${eventTitle(n)}${n.issuer ? ` (${n.issuer})` : ""}`,
    `When: ${when}`,
    n.affectedAreas.length ? `Areas: ${n.affectedAreas.join(", ")}` : "",
    n.explanation,
    ...n.requirements.map((r) => `- ${r}`),
    "Summary made by an AI tool from a photo. Please check the original notice.",
  ]
    .filter(Boolean)
    .join("\n");
}

export type Change = { field: string; before: string; after: string };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function compareNotices(a: Notice, b: Notice): Change[] {
  const show = (v: string | null) => v ?? "not stated";
  const changes: Change[] = [];
  const scalar: [string, string | null, string | null][] = [
    ["Date", a.eventDate, b.eventDate],
    ["End date", a.endDate, b.endDate],
    ["Start time", a.startTime, b.startTime],
    ["End time", a.endTime, b.endTime],
    ["Issuer", a.issuer, b.issuer],
  ];
  for (const [field, before, after] of scalar) {
    if (norm(before ?? "") !== norm(after ?? "")) {
      changes.push({ field, before: show(before), after: show(after) });
    }
  }
  const setA = new Set(a.affectedAreas.map(norm));
  const setB = new Set(b.affectedAreas.map(norm));
  const added = b.affectedAreas.filter((x) => !setA.has(norm(x)));
  const removed = a.affectedAreas.filter((x) => !setB.has(norm(x)));
  if (added.length || removed.length) {
    changes.push({
      field: "Affected areas",
      before: removed.length ? `Removed: ${removed.join(", ")}` : "Nothing removed",
      after: added.length ? `Added: ${added.join(", ")}` : "Nothing added",
    });
  }
  return changes;
}

export type AreaMatch = "affected" | "not-listed" | "unknown";

// Plain text match of the resident's area against the areas read from the notice.
export function matchArea(n: Notice, area: string): AreaMatch {
  const q = norm(area);
  if (q.length < 3 || n.affectedAreas.length === 0) return "unknown";
  return n.affectedAreas.some((a) => norm(a).includes(q) || q.includes(norm(a)))
    ? "affected"
    : "not-listed";
}
