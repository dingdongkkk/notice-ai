import { LANGUAGES, isIsoDate, isTime, type Language, type Notice } from "./schema";

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

export function formatDate(date: string, language: Language = "en"): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(LANGUAGES[language].speech, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function formatRange(start: string | null, end: string | null): string {
  if (!start) return "no time stated";
  return end ? `${formatTime(start)} to ${formatTime(end)}` : formatTime(start);
}

export function formatWhen(e: ConfirmedEvent, language: Language = "en"): string {
  const day = formatDate(e.date, language);
  return e.startTime ? `${day}, ${formatRange(e.startTime, e.endTime)}` : day;
}

export function eventTitle(n: Notice): string {
  return n.title || n.documentType || "Public notice";
}

// `uid` stays the same for a notice and its revisions, and `sequence` rises
// with each approved change, so a calendar can treat the file as an update.
export function buildIcs(n: Notice, e: ConfirmedEvent, uid: string, sequence: number): string {
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
  const place = n.officeLocation || n.affectedAreas.join(", ");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Notice to Action//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${stamp}`,
    ...when,
    `SUMMARY:${esc(eventTitle(n))}`,
    `DESCRIPTION:${esc(description)}`,
    place ? `LOCATION:${esc(place)}` : "",
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

// ---- Saved reminders -------------------------------------------------------

export type SavedReminder = ConfirmedEvent & {
  threadId: string;
  uid: string;
  sequence: number;
  title: string;
  savedAt: string;
};

export type SaveResult = {
  list: SavedReminder[];
  reminder: SavedReminder;
  status: "created" | "updated" | "unchanged";
  previous: SavedReminder | null;
};

// One reminder per notice thread. Approving again never adds a second one.
export function saveReminder(
  list: SavedReminder[],
  threadId: string,
  n: Notice,
  e: ConfirmedEvent,
): SaveResult {
  const previous = list.find((r) => r.threadId === threadId) ?? null;
  const same =
    previous &&
    previous.date === e.date &&
    previous.startTime === e.startTime &&
    previous.endTime === e.endTime;
  if (previous && same) return { list, reminder: previous, status: "unchanged", previous };
  const reminder: SavedReminder = {
    ...e,
    threadId,
    uid: previous?.uid ?? `${threadId}@notice-to-action`,
    sequence: previous ? previous.sequence + 1 : 0,
    title: eventTitle(n),
    savedAt: new Date().toISOString(),
  };
  return {
    list: [...list.filter((r) => r.threadId !== threadId), reminder],
    reminder,
    status: previous ? "updated" : "created",
    previous,
  };
}

// ---- Household relevance ---------------------------------------------------

export type YesNo = "" | "yes" | "no";
export type Profile = {
  locality: string;
  student: YesNo;
  senior: YesNo;
  provider: "" | "bwssb" | "other";
};
export const EMPTY_PROFILE: Profile = { locality: "", student: "", senior: "", provider: "" };

export type Outcome = "match" | "no-match" | "unknown";
export type Check = { outcome: Outcome; reason: string; field: string };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function areaListed(n: Notice, area: string): boolean {
  const q = norm(area);
  return n.affectedAreas.some((a) => norm(a).includes(q) || q.includes(norm(a)));
}

// Compares the notice's stated areas and conditions with the household
// profile in plain code. It reports what it could and could not check and
// never claims final eligibility.
export function checkRelevance(n: Notice, p: Profile): { outcome: Outcome; checks: Check[] } {
  const checks: Check[] = [];
  if (n.affectedAreas.length > 0) {
    const locality = p.locality.trim();
    if (locality.length < 3) {
      checks.push({
        outcome: "unknown",
        field: "affectedAreas",
        reason: "Add your locality to check it against the areas in the notice.",
      });
    } else if (areaListed(n, locality)) {
      checks.push({
        outcome: "match",
        field: "affectedAreas",
        reason: `"${locality}" is among the areas listed in the notice.`,
      });
    } else {
      checks.push({
        outcome: "no-match",
        field: "affectedAreas",
        reason: `"${locality}" was not found among the listed areas (${n.affectedAreas.join(", ")}). Spellings vary and notices often add "surrounding areas", so check the photo.`,
      });
    }
  }
  if (p.provider && n.issuer) {
    const fromBwssb = /bwssb|water supply and sewerage/i.test(n.issuer);
    if (fromBwssb && p.provider === "other") {
      checks.push({
        outcome: "no-match",
        field: "issuer",
        reason: "The notice is from BWSSB, and you said your water comes from another provider.",
      });
    } else if (fromBwssb && p.provider === "bwssb") {
      checks.push({
        outcome: "match",
        field: "issuer",
        reason: "The notice is from BWSSB, your water provider.",
      });
    }
  }
  for (const c of n.conditions) {
    const answer = c.requires === "student" ? p.student : c.requires === "senior_citizen" ? p.senior : null;
    const who = c.requires === "student" ? "a student" : "a senior citizen";
    if (answer === null) {
      checks.push({
        outcome: "unknown",
        field: "conditions",
        reason: `Cannot be checked automatically: ${c.text}`,
      });
    } else if (answer === "") {
      checks.push({
        outcome: "unknown",
        field: "conditions",
        reason: `Tell us whether your household has ${who} to check: ${c.text}`,
      });
    } else {
      checks.push({
        outcome: answer === "yes" ? "match" : "no-match",
        field: "conditions",
        reason: `${c.text} You said your household ${answer === "yes" ? "has" : "does not have"} ${who}.`,
      });
    }
  }
  const outcome: Outcome =
    checks.length === 0 || checks.some((c) => c.outcome === "unknown")
      ? checks.some((c) => c.outcome === "no-match")
        ? "no-match"
        : "unknown"
      : checks.some((c) => c.outcome === "no-match")
        ? "no-match"
        : "match";
  return { outcome, checks };
}

// ---- Family card -----------------------------------------------------------

export type FamilyCard = {
  happened: string;
  when: string;
  where: string | null;
  official: string[];
  suggested: string[];
  source: string;
  madeOn: string;
};

export function buildCard(
  n: Notice,
  e: ConfirmedEvent | null,
  language: Language,
  hidePersonal: boolean,
): FamilyCard {
  const hide = (s: string) => {
    if (!hidePersonal) return s;
    let out = s;
    for (const detail of n.personalDetails) out = out.split(detail).join("[hidden]");
    return out.replace(/\d{8,}/g, "[hidden]");
  };
  const when = e
    ? formatWhen(e, language)
    : n.dateText
      ? `${n.dateText} (as written, not yet confirmed)`
      : "Not stated. Check the notice.";
  return {
    happened: hide(n.headline || n.explanation),
    when: hide(when),
    where: n.officeLocation
      ? hide(n.officeLocation)
      : n.affectedAreas.length
        ? hide(n.affectedAreas.join(", "))
        : null,
    official: n.requirements.map(hide),
    suggested: n.suggestions.map(hide),
    source: hide(
      [n.issuer, n.referenceNumber ? `ref. ${n.referenceNumber}` : ""].filter(Boolean).join(", ") ||
        "Issuer not stated",
    ),
    madeOn: formatDate(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }), language),
  };
}

// ---- Revision comparison ---------------------------------------------------

export type Change = { field: string; sentence: string; planUpdate: string | null };

function listDiff(a: string[], b: string[]) {
  const setA = new Set(a.map(norm));
  const setB = new Set(b.map(norm));
  return {
    added: b.filter((x) => !setA.has(norm(x))),
    removed: a.filter((x) => !setB.has(norm(x))),
  };
}

export function compareNotices(a: Notice, b: Notice): Change[] {
  const changes: Change[] = [];
  const differs = (x: string | null, y: string | null) => norm(x ?? "") !== norm(y ?? "");
  const label = b.dateKind === "deadline" ? "deadline" : "date";

  if (differs(a.eventDate, b.eventDate)) {
    let sentence: string;
    if (isIsoDate(a.eventDate) && isIsoDate(b.eventDate)) {
      const days = Math.round((Date.parse(b.eventDate) - Date.parse(a.eventDate)) / 86_400_000);
      const n = Math.abs(days);
      sentence = `The ${label} moved ${days > 0 ? "later" : "earlier"} by ${n} day${n === 1 ? "" : "s"}: ${formatDate(a.eventDate)} → ${formatDate(b.eventDate)}.`;
    } else {
      sentence = `The ${label} changed: ${a.eventDate ?? "not readable"} → ${b.eventDate ?? "not readable"}.`;
    }
    changes.push({ field: "date", sentence, planUpdate: "your reminder" });
  }
  if (differs(a.startTime, b.startTime) || differs(a.endTime, b.endTime)) {
    changes.push({
      field: "time",
      sentence: `The time changed: ${formatRange(a.startTime, a.endTime)} → ${formatRange(b.startTime, b.endTime)}.`,
      planUpdate: "your reminder",
    });
  }
  const areas = listDiff(a.affectedAreas, b.affectedAreas);
  if (areas.added.length || areas.removed.length) {
    changes.push({
      field: "affectedAreas",
      sentence: [
        areas.added.length ? `Areas added: ${areas.added.join(", ")}.` : "",
        areas.removed.length ? `Areas removed: ${areas.removed.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      planUpdate: "whether it affects your household",
    });
  }
  if (differs(a.officeLocation, b.officeLocation)) {
    changes.push({
      field: "office",
      sentence: `The office location changed: ${a.officeLocation ?? "not stated"} → ${b.officeLocation ?? "not stated"}.`,
      planUpdate: "where to go",
    });
  }
  if (differs(a.amount, b.amount)) {
    changes.push({
      field: "amount",
      sentence: `The amount changed: ${a.amount ?? "not stated"} → ${b.amount ?? "not stated"}.`,
      planUpdate: null,
    });
  }
  const docs = listDiff(a.documentsRequired, b.documentsRequired);
  if (docs.added.length || docs.removed.length) {
    changes.push({
      field: "documents",
      sentence: [
        docs.added.length ? `Documents added: ${docs.added.join(", ")}.` : "",
        docs.removed.length ? `Documents no longer listed: ${docs.removed.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      planUpdate: "the documents to carry",
    });
  }
  if (differs(a.issuer, b.issuer)) {
    changes.push({
      field: "issuer",
      sentence: `The issuer reads differently: ${a.issuer ?? "not stated"} → ${b.issuer ?? "not stated"}. Check that this notice really replaces the earlier one.`,
      planUpdate: null,
    });
  }
  return changes;
}

export function planUpdates(changes: Change[]): string[] {
  return [...new Set(changes.flatMap((c) => (c.planUpdate ? [c.planUpdate] : [])))];
}
