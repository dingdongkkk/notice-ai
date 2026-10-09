import type { Notice } from "./schema";

export type ExternalRecord = {
  kind: "helpline" | "office";
  service: string;
  detail: string;
  // null means the source does not give opening hours.
  hours: string | null;
  matchRule: string;
  sourceUrl: string;
  retrieved: string;
};

// Hand-maintained public records. Both come from third-party pages, not from
// BWSSB's own site, and the office is a candidate only: it is the head office,
// not necessarily the office that serves a given area.
const RECORDS: (ExternalRecord & { pattern: RegExp })[] = [
  {
    kind: "helpline",
    service: "BWSSB 24-hour helpline",
    detail: "Dial 1916 for water supply complaints and questions.",
    hours: "24 hours, as reported",
    matchRule: "The notice is from BWSSB or is about water supply in Bengaluru.",
    sourceUrl:
      "https://www.deccanherald.com/india/karnataka/bengaluru/bwssb-water-adalat-on-august-11-1135018.html",
    retrieved: "2026-10-09",
    pattern: /bwssb|water supply|water board|ಜಲಮಂಡಳಿ|ನೀರು/i,
  },
  {
    kind: "office",
    service: "BWSSB head office (candidate)",
    detail: "Cauvery Bhavan, Kempegowda Road, Bengaluru 560009.",
    hours: null,
    matchRule: "The notice is from BWSSB. Your local sub-division office may be the right one instead.",
    sourceUrl: "https://bpac.in/bengaluru-citizen-dashboard/department/bwssb",
    retrieved: "2026-10-09",
    pattern: /bwssb|water supply and sewerage|ಜಲಮಂಡಳಿ/i,
  },
];

export function findRecords(n: Notice): ExternalRecord[] {
  const haystack = [n.issuer, n.title, n.documentType, n.explanation, ...n.evidence.map((e) => e.quote)]
    .filter(Boolean)
    .join(" ");
  return RECORDS.filter((r) => r.pattern.test(haystack)).map((r) => ({
    kind: r.kind,
    service: r.service,
    detail: r.detail,
    hours: r.hours,
    matchRule: r.matchRule,
    sourceUrl: r.sourceUrl,
    retrieved: r.retrieved,
  }));
}

// Synthetic fixtures for demo mode only. They are never returned by the API.
export const FIXTURE_WATER: Notice = {
  category: "water",
  documentType: "Water supply interruption notice",
  issuer: "BWSSB (synthetic sample)",
  title: "Water supply interruption",
  headline: "There will be no water supply in the listed areas for one day.",
  referenceNumber: "SAMPLE/2026/101",
  originalLanguage: "English",
  affectedAreas: ["Mathikere", "Yeshwanthpur", "MSR Nagar"],
  dateKind: "event",
  dateText: "14-10-2026 from 9 AM to 6 PM",
  eventDate: "2026-10-14",
  endDate: null,
  startTime: "09:00",
  endTime: "18:00",
  amount: null,
  officeLocation: null,
  documentsRequired: [],
  conditions: [],
  requirements: ["Store enough water in advance.", "Use water sparingly on that day."],
  suggestions: ["Fill drinking water bottles the evening before.", "Tell elderly neighbours who may not have seen the notice."],
  personalDetails: [],
  explanation:
    "Water supply will be stopped for maintenance work on 14 October 2026 from 9 AM to 6 PM in the listed areas. Store water the evening before.",
  evidence: [
    { field: "issuer", quote: "Bangalore Water Supply and Sewerage Board" },
    { field: "date", quote: "on 14-10-2026 from 9 AM to 6 PM" },
    { field: "time", quote: "on 14-10-2026 from 9 AM to 6 PM" },
    { field: "affectedAreas", quote: "Mathikere, Yeshwanthpur, MSR Nagar and surrounding areas" },
    { field: "requirements", quote: "Consumers are requested to store sufficient water and co-operate." },
  ],
  unresolved: [],
};

export const FIXTURE_WATER_REVISED: Notice = {
  ...FIXTURE_WATER,
  headline: "The water supply interruption has been moved to a new day.",
  referenceNumber: "SAMPLE/2026/101-R",
  affectedAreas: ["Mathikere", "Yeshwanthpur", "Sanjaynagar"],
  dateText: "16-10-2026 from 10 AM to 4 PM",
  eventDate: "2026-10-16",
  startTime: "10:00",
  endTime: "16:00",
  explanation:
    "The maintenance work has moved to 16 October 2026 from 10 AM to 4 PM. Sanjaynagar is now affected and MSR Nagar is not.",
  evidence: [
    { field: "issuer", quote: "Bangalore Water Supply and Sewerage Board" },
    { field: "date", quote: "rescheduled to 16-10-2026 from 10 AM to 4 PM" },
    { field: "time", quote: "rescheduled to 16-10-2026 from 10 AM to 4 PM" },
    { field: "affectedAreas", quote: "Mathikere, Yeshwanthpur, Sanjaynagar" },
    { field: "requirements", quote: "Consumers are requested to store sufficient water and co-operate." },
  ],
};

export const FIXTURE_SCHOLARSHIP: Notice = {
  category: "scholarship",
  documentType: "Scholarship notice",
  issuer: "Sample Education Trust (synthetic sample)",
  title: "Merit scholarship applications",
  headline: "Students can apply for a merit scholarship before the deadline.",
  referenceNumber: "SAMPLE/SCH/7",
  originalLanguage: "English",
  affectedAreas: [],
  dateKind: "deadline",
  dateText: "on or before 30-10-2026, 5 PM",
  eventDate: "2026-10-30",
  endDate: null,
  startTime: "17:00",
  endTime: null,
  amount: "Rs. 10,000 per year",
  officeLocation: "Trust office, Room 12, Sample College campus",
  documentsRequired: ["Previous year marks card", "Family income certificate", "College ID card", "Bank passbook copy"],
  conditions: [
    { text: "The applicant must be a student in a degree course.", requires: "student" },
    { text: "Family income must be below Rs. 2.5 lakh per year.", requires: "other" },
  ],
  requirements: ["Submit the filled application form with the documents at the trust office."],
  suggestions: ["Make photocopies of every document before you go.", "Apply a few days early in case a document is missing."],
  personalDetails: [],
  explanation:
    "A merit scholarship of Rs. 10,000 per year is open to degree students whose family income is below Rs. 2.5 lakh. Applications with documents must reach the trust office by 30 October 2026, 5 PM.",
  evidence: [
    { field: "date", quote: "Applications must be submitted on or before 30-10-2026, 5 PM" },
    { field: "amount", quote: "a scholarship of Rs. 10,000 per year" },
    { field: "office", quote: "at the Trust office, Room 12, Sample College campus" },
    { field: "documents", quote: "Enclose: marks card, income certificate, college ID, bank passbook copy" },
    { field: "conditions", quote: "Open to students of degree courses with family income below Rs. 2.5 lakh per annum" },
    { field: "requirements", quote: "Submit the filled application form along with the enclosures" },
  ],
  unresolved: [],
};
