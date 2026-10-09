import type { Category, Notice } from "./schema";

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

// Hand-maintained public records. The BWSSB entries come from third-party
// pages, not from BWSSB's own site, and the office is a candidate only: it is
// the head office, not necessarily the office that serves a given area.
const RECORDS: (ExternalRecord & { pattern: RegExp; categories?: Category[] })[] = [
  {
    kind: "helpline",
    service: "Free legal aid helpline (NALSA)",
    detail: "Dial 15100, the toll-free legal aid helpline of the National Legal Services Authority.",
    hours: null,
    matchRule: "The document is a legal notice or court paper.",
    sourceUrl: "https://nalsa.gov.in/promoting-inclusive-legal-system/",
    retrieved: "2026-10-09",
    pattern: /legal notice|summons|court|tribunal|advocate|ನ್ಯಾಯಾಲಯ|ವಕೀಲ/i,
    categories: ["legal"],
  },
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
  return RECORDS.filter(
    (r) => r.categories?.includes(n.category) || r.pattern.test(haystack),
  ).map((r) => ({
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
  addressedTo: "Residents of the listed areas",
  consequences: [],
  lawsCited: [],
  keyTerms: [],
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
  addressedTo: "Students of degree courses",
  consequences: ["Applications received after the deadline will not be considered."],
  lawsCited: [],
  keyTerms: [
    { term: "Per annum", meaning: "Each year." },
    { term: "Enclosures", meaning: "The papers you attach to the form." },
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
    { field: "consequences", quote: "Applications received after the due date will not be entertained" },
  ],
  unresolved: [],
};

export const FIXTURE_CIRCULAR: Notice = {
  category: "circular",
  documentType: "Government circular",
  issuer: "Sample Transport Department (synthetic sample)",
  title: "Senior citizen bus pass renewal",
  headline: "Senior citizens must renew their bus pass before the end of the month.",
  referenceNumber: "SAMPLE/TD/CIR/42",
  addressedTo: "Holders of a senior citizen bus pass",
  originalLanguage: "English",
  affectedAreas: [],
  dateKind: "deadline",
  dateText: "on or before 31-10-2026",
  eventDate: "2026-10-31",
  endDate: null,
  startTime: null,
  endTime: null,
  amount: "Rs. 50 renewal fee",
  officeLocation: "Any sample depot pass counter, 10 AM to 4 PM on working days",
  documentsRequired: ["Existing bus pass", "Proof of age", "One passport-size photograph"],
  conditions: [{ text: "The pass holder must be aged 60 or above.", requires: "senior_citizen" }],
  requirements: ["Renew the pass in person at a depot pass counter before the deadline."],
  consequences: ["Passes that are not renewed will stop being valid from 1 November 2026."],
  lawsCited: ["Sample Transport Circular No. 42 of 2026"],
  keyTerms: [
    { term: "Competent authority", meaning: "The officer who is allowed to decide or approve this." },
    { term: "Lapse", meaning: "To stop being valid." },
    { term: "In person", meaning: "You must go yourself; someone else cannot go for you." },
  ],
  suggestions: ["Go on a weekday morning to avoid the end-of-month rush.", "Carry a photocopy of each document."],
  personalDetails: [],
  explanation:
    "People who hold a senior citizen bus pass must renew it at a depot pass counter by 31 October 2026. The fee is Rs. 50. A pass that is not renewed stops working from 1 November 2026.",
  evidence: [
    { field: "date", quote: "shall renew the same on or before 31-10-2026" },
    { field: "amount", quote: "on payment of a renewal fee of Rs. 50" },
    { field: "office", quote: "at any depot pass counter between 10 AM and 4 PM on working days" },
    { field: "documents", quote: "along with the existing pass, proof of age and one passport-size photograph" },
    { field: "conditions", quote: "pass holders aged 60 years and above" },
    { field: "requirements", quote: "shall renew the same in person" },
    { field: "consequences", quote: "passes not renewed shall lapse with effect from 01-11-2026" },
    { field: "laws", quote: "Circular No. 42 of 2026" },
  ],
  unresolved: [],
};

export const FIXTURE_LEGAL: Notice = {
  category: "legal",
  documentType: "Legal notice",
  issuer: "Advocate for the Sample Residents' Association (synthetic sample)",
  title: "Legal notice for unpaid maintenance dues",
  headline: "A lawyer's notice asks the flat owner to pay unpaid maintenance dues.",
  referenceNumber: "SAMPLE/LN/2026/18",
  addressedTo: "The flat owner named in the notice",
  originalLanguage: "English",
  affectedAreas: [],
  dateKind: "deadline",
  dateText: "within 15 days from the receipt of this notice",
  eventDate: null,
  endDate: null,
  startTime: null,
  endTime: null,
  amount: "Rs. 18,000",
  officeLocation: null,
  documentsRequired: [],
  conditions: [],
  requirements: ["Pay the stated dues within 15 days of receiving the notice, or reply in writing."],
  consequences: [
    "The association says it will file a recovery case in court.",
    "It says it will also claim interest and legal costs.",
  ],
  lawsCited: ["Clause 10 of the Sample Apartment Bye-laws"],
  keyTerms: [
    { term: "Legal notice", meaning: "A formal letter, usually from a lawyer, asking you to do something before a court case is started." },
    { term: "My client", meaning: "The person or group the lawyer is writing for. Here, the residents' association." },
    { term: "Recovery suit", meaning: "A court case asking a judge to order that money be paid." },
    { term: "Arrears", meaning: "Money that was due earlier and is still unpaid." },
  ],
  suggestions: [
    "Keep the original notice and the envelope that shows when it arrived.",
    "Write down the date you received it; the 15 days are counted from then.",
    "Speak to a lawyer or free legal aid before you reply or pay.",
  ],
  personalDetails: [],
  explanation:
    "A lawyer acting for the residents' association says Rs. 18,000 in maintenance dues is unpaid. The notice asks for payment within 15 days of receiving it, and says a court case will follow otherwise. This only explains what the notice says; it does not say whether the claim is correct.",
  evidence: [
    { field: "issuer", quote: "Under instructions from my client, the Sample Residents' Association" },
    { field: "amount", quote: "arrears of maintenance charges amounting to Rs. 18,000" },
    { field: "date", quote: "within 15 days from the receipt of this notice" },
    { field: "requirements", quote: "you are hereby called upon to pay the said amount" },
    { field: "consequences", quote: "failing which my client shall be constrained to file a suit for recovery with interest and costs" },
    { field: "laws", quote: "as required under Clause 10 of the Bye-laws" },
  ],
  unresolved: [
    "The deadline is 15 days from the day you received the notice. The notice gives no calendar date, so work it out and enter it yourself.",
  ],
};
