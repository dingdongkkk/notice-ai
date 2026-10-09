import type { Notice } from "./schema";

export type ExternalRecord = {
  service: string;
  detail: string;
  matchRule: string;
  sourceUrl: string;
  retrieved: string | null;
};

// Hand-maintained public records. `retrieved` is the date the detail was
// checked against the source; while it is null the UI says it is unchecked.
const RECORDS: (ExternalRecord & { pattern: RegExp })[] = [
  {
    service: "BWSSB water supply complaints",
    detail: "BWSSB 24-hour helpline: dial 1916 (as reported by Deccan Herald).",
    matchRule: "Notice is issued by BWSSB or is about water supply in Bengaluru.",
    sourceUrl:
      "https://www.deccanherald.com/india/karnataka/bengaluru/bwssb-water-adalat-on-august-11-1135018.html",
    retrieved: "2026-10-09",
    pattern: /bwssb|water supply|water board|ಜಲಮಂಡಳಿ|ನೀರು/i,
  },
];

export function findRecord(n: Notice): ExternalRecord | null {
  const haystack = [n.issuer, n.title, n.documentType, n.explanation, ...n.evidence.map((e) => e.quote)]
    .filter(Boolean)
    .join(" ");
  const hit = RECORDS.find((r) => r.pattern.test(haystack));
  if (!hit) return null;
  return {
    service: hit.service,
    detail: hit.detail,
    matchRule: hit.matchRule,
    sourceUrl: hit.sourceUrl,
    retrieved: hit.retrieved,
  };
}

// Synthetic fixtures for demo mode only. They are never returned by the API.
export const FIXTURE_ORIGINAL: Notice = {
  documentType: "Water supply interruption notice",
  issuer: "BWSSB (synthetic sample)",
  title: "Water supply interruption",
  originalLanguage: "English",
  affectedAreas: ["Mathikere", "Yeshwanthpur", "MSR Nagar"],
  dateText: "14 October 2026, 9 AM to 6 PM",
  eventDate: "2026-10-14",
  endDate: null,
  startTime: "09:00",
  endTime: "18:00",
  requirements: ["Store enough water in advance.", "Use water sparingly on that day."],
  explanation:
    "Water supply will be stopped for maintenance work on 14 October 2026 from 9 AM to 6 PM in the listed areas. Store water the evening before.",
  evidence: [
    { field: "date", quote: "on 14-10-2026 from 9 AM to 6 PM" },
    { field: "affectedAreas", quote: "Mathikere, Yeshwanthpur, MSR Nagar and surrounding areas" },
  ],
  unresolved: [],
};

export const FIXTURE_REVISED: Notice = {
  ...FIXTURE_ORIGINAL,
  affectedAreas: ["Mathikere", "Yeshwanthpur", "Sanjaynagar"],
  dateText: "16 October 2026, 10 AM to 4 PM",
  eventDate: "2026-10-16",
  startTime: "10:00",
  endTime: "16:00",
  explanation:
    "The maintenance work has moved to 16 October 2026 from 10 AM to 4 PM. Sanjaynagar is now affected and MSR Nagar is not.",
  evidence: [
    { field: "date", quote: "rescheduled to 16-10-2026 from 10 AM to 4 PM" },
    { field: "affectedAreas", quote: "Mathikere, Yeshwanthpur, Sanjaynagar" },
  ],
};
