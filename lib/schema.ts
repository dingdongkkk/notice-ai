import { z } from "zod";

const text = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === "" || s.toLowerCase() === "null" ? null : s;
  });

const list = z
  .array(z.union([z.string(), z.number()]).nullish())
  .nullish()
  .transform((v) =>
    (v ?? []).map((s) => (s == null ? "" : String(s).trim())).filter(Boolean),
  );

export type Requires = "student" | "senior_citizen" | "other";
export type Condition = { text: string; requires: Requires };

const conditions = z
  .array(z.union([z.string(), z.object({ text, requires: text })]).nullish())
  .nullish()
  .transform((v) =>
    (v ?? []).flatMap((c): Condition[] => {
      if (!c) return [];
      if (typeof c === "string") return c.trim() ? [{ text: c.trim(), requires: "other" }] : [];
      if (!c.text) return [];
      const requires =
        c.requires === "student" || c.requires === "senior_citizen" ? c.requires : "other";
      return [{ text: c.text, requires }];
    }),
  );

const RawNotice = z.object({
  category: text,
  documentType: text,
  issuer: text,
  title: text,
  headline: text,
  referenceNumber: text,
  originalLanguage: text,
  affectedAreas: list,
  dateKind: text,
  dateText: text,
  eventDate: text,
  endDate: text,
  startTime: text,
  endTime: text,
  amount: text,
  officeLocation: text,
  documentsRequired: list,
  conditions,
  requirements: list,
  suggestions: list,
  personalDetails: list,
  explanation: text,
  evidence: z
    .array(z.object({ field: text, quote: text }))
    .nullish()
    .transform((v) =>
      (v ?? []).flatMap((e) =>
        e.field && e.quote ? [{ field: e.field, quote: e.quote }] : [],
      ),
    ),
  unresolved: list,
});

export type Category = "water" | "scholarship" | "other";

export type Notice = {
  category: Category;
  documentType: string | null;
  issuer: string | null;
  title: string | null;
  headline: string | null;
  referenceNumber: string | null;
  originalLanguage: string | null;
  affectedAreas: string[];
  dateKind: "event" | "deadline";
  dateText: string | null;
  eventDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  amount: string | null;
  officeLocation: string | null;
  documentsRequired: string[];
  conditions: Condition[];
  requirements: string[];
  suggestions: string[];
  personalDetails: string[];
  explanation: string;
  evidence: { field: string; quote: string }[];
  unresolved: string[];
};

export type Language = "en" | "kn" | "hi";

export const LANGUAGES: Record<Language, { name: string; label: string; speech: string }> = {
  en: { name: "English", label: "English", speech: "en-IN" },
  kn: { name: "Kannada", label: "ಕನ್ನಡ (Kannada)", speech: "kn-IN" },
  hi: { name: "Hindi", label: "हिन्दी (Hindi)", speech: "hi-IN" },
};

export function toLanguage(v: unknown): Language {
  return v === "kn" || v === "hi" ? v : "en";
}

export function isIsoDate(s: string | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isTime(s: string | null): s is string {
  return !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// Validates model output. Anything that is not a well-formed date or time is
// dropped to null and listed as unresolved instead of being passed along.
export function parseNotice(input: unknown): Notice {
  const raw = RawNotice.parse(input);
  if (!raw.explanation) throw new Error("explanation missing");
  const unresolved = [...raw.unresolved];
  const date = (v: string | null, label: string) => {
    if (v === null) return null;
    if (isIsoDate(v)) return v;
    unresolved.push(`${label} could not be read as a calendar date ("${v}")`);
    return null;
  };
  const time = (v: string | null, label: string) => {
    if (v === null) return null;
    if (isTime(v)) return v;
    unresolved.push(`${label} could not be read as a time ("${v}")`);
    return null;
  };
  const eventDate = date(raw.eventDate, "Date");
  if (!eventDate && !unresolved.some((u) => /date/i.test(u))) {
    unresolved.push("No date could be read from the notice");
  }
  return {
    ...raw,
    category:
      raw.category === "water" || raw.category === "scholarship" ? raw.category : "other",
    dateKind: raw.dateKind === "deadline" ? "deadline" : "event",
    explanation: raw.explanation,
    eventDate,
    endDate: date(raw.endDate, "End date"),
    startTime: time(raw.startTime, "Start time"),
    endTime: time(raw.endTime, "End time"),
    unresolved,
  };
}
