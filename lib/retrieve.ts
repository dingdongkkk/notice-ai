import { database } from "./db";
import { FIXTURE_CIRCULAR, FIXTURE_SCHOLARSHIP, FIXTURE_WATER } from "./data";
import type { Notice } from "./schema";

// ---- Text and embeddings ---------------------------------------------------

// The words a notice is found by: what it is, who sent it, and what it says.
export function searchText(n: Notice): string {
  return [
    n.documentType,
    n.title,
    n.issuer,
    n.headline,
    n.explanation,
    n.affectedAreas.join(", "),
    n.requirements.join(" "),
    n.consequences.join(" "),
    n.documentsRequired.join(", "),
    n.keyTerms.map((k) => `${k.term}: ${k.meaning}`).join(" "),
    n.lawsCited.join(", "),
  ]
    .filter(Boolean)
    .join("\n");
}

// Meaning-based search uses Google's embedding model when a Google key is
// set. Without it, search falls back to matching words.
export async function embed(text: string): Promise<number[] | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === "your_key_here") return null;
  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          content: { parts: [{ text: text.slice(0, 6000) }] },
          outputDimensionality: 256,
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const values = (await res.json())?.embedding?.values;
    return Array.isArray(values) && values.length > 0 ? values : null;
  } catch {
    return null;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{M}\p{N}]{3,}/gu) ?? []);

function overlap(query: string, text: string): number {
  const q = words(query);
  const t = words(text);
  let hits = 0;
  for (const w of q) if (t.has(w)) hits++;
  return q.size ? hits / q.size : 0;
}

type Row = { id: number; search_text: string; embedding: string | null };

// Ranks rows against a question: by meaning when both sides have an
// embedding, otherwise by shared words.
async function rank<T extends Row>(
  table: "documents" | "library",
  rows: T[],
  query: string,
  limit: number,
): Promise<T[]> {
  const queryVector = await embed(query);
  const update = database().prepare(`UPDATE ${table} SET embedding = ? WHERE id = ?`);
  const scored = [];
  for (const row of rows) {
    let vector: number[] | null = row.embedding ? JSON.parse(row.embedding) : null;
    if (!vector && queryVector) {
      vector = await embed(row.search_text);
      if (vector) update.run(JSON.stringify(vector), row.id);
    }
    const score =
      queryVector && vector ? cosine(queryVector, vector) : overlap(query, row.search_text);
    scored.push({ row, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.row);
}

// ---- A person's own notices -------------------------------------------------

export type SavedDocument = { id: number; created: string; language: string; notice: Notice };
type DocumentRow = Row & { created: string; language: string; notice: string };

const toSaved = (r: DocumentRow): SavedDocument => ({
  id: r.id,
  created: r.created,
  language: r.language,
  notice: JSON.parse(r.notice),
});

export function listDocuments(userId: number): SavedDocument[] {
  const rows = database()
    .prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY created DESC LIMIT 100")
    .all(userId) as DocumentRow[];
  return rows.map(toSaved);
}

export async function saveDocument(userId: number, notice: Notice, language: string): Promise<number> {
  const text = searchText(notice);
  const vector = await embed(text);
  const result = database()
    .prepare(
      "INSERT INTO documents (user_id, created, language, notice, search_text, embedding) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      userId,
      new Date().toISOString(),
      language,
      JSON.stringify(notice),
      text,
      vector ? JSON.stringify(vector) : null,
    );
  return Number(result.lastInsertRowid);
}

export function deleteDocument(userId: number, id: number): boolean {
  return (
    database().prepare("DELETE FROM documents WHERE id = ? AND user_id = ?").run(id, userId).changes > 0
  );
}

export async function findDocuments(userId: number, query: string, limit = 4): Promise<SavedDocument[]> {
  const rows = database()
    .prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY created DESC LIMIT 200")
    .all(userId) as DocumentRow[];
  return (await rank("documents", rows, query, limit)).map(toSaved);
}

// ---- The shared library ------------------------------------------------------

// What may be shared: a general description of a public notice. No dates,
// reference numbers, addressee, areas, photo, or anything the model listed as
// personal. Legal papers and unclassified documents are never shared.
export type LibraryEntry = {
  category: string;
  documentType: string | null;
  issuer: string | null;
  title: string | null;
  headline: string | null;
  explanation: string;
  requirements: string[];
  consequences: string[];
  keyTerms: { term: string; meaning: string }[];
  lawsCited: string[];
};

const SHAREABLE = ["water", "scholarship", "circular"];

export function canShare(n: Notice): boolean {
  return SHAREABLE.includes(n.category);
}

export function toLibraryEntry(n: Notice): LibraryEntry {
  const clean = (s: string) => {
    let out = s;
    for (const detail of n.personalDetails) out = out.split(detail).join("[removed]");
    return out.replace(/\d{6,}/g, "[number]");
  };
  const opt = (s: string | null) => (s ? clean(s) : null);
  return {
    category: n.category,
    documentType: opt(n.documentType),
    issuer: opt(n.issuer),
    title: opt(n.title),
    headline: opt(n.headline),
    explanation: clean(n.explanation),
    requirements: n.requirements.map(clean),
    consequences: n.consequences.map(clean),
    keyTerms: n.keyTerms.map((k) => ({ term: clean(k.term), meaning: clean(k.meaning) })),
    lawsCited: n.lawsCited.map(clean),
  };
}

function entryText(e: LibraryEntry): string {
  return [
    e.documentType,
    e.title,
    e.issuer,
    e.headline,
    e.explanation,
    e.requirements.join(" "),
    e.consequences.join(" "),
    e.keyTerms.map((k) => `${k.term}: ${k.meaning}`).join(" "),
    e.lawsCited.join(", "),
  ]
    .filter(Boolean)
    .join("\n");
}

// Returns false when an entry for the same kind of notice is already there.
export function addToLibrary(n: Notice, source: "user" | "sample"): boolean {
  if (!canShare(n)) return false;
  const entry = toLibraryEntry(n);
  const dedupe = [entry.category, entry.issuer, entry.title].join("|").toLowerCase();
  const result = database()
    .prepare(
      "INSERT OR IGNORE INTO library (created, source, dedupe, summary, search_text) VALUES (?, ?, ?, ?, ?)",
    )
    .run(new Date().toISOString(), source, dedupe, JSON.stringify(entry), entryText(entry));
  return result.changes > 0;
}

type LibraryRow = Row & { source: string; summary: string };

// The library starts with the app's own synthetic samples so it is not empty.
function seedLibrary() {
  const { n } = database()
    .prepare("SELECT COUNT(*) AS n FROM library WHERE source = 'sample'")
    .get() as { n: number };
  if (n > 0) return;
  for (const sample of [FIXTURE_WATER, FIXTURE_SCHOLARSHIP, FIXTURE_CIRCULAR]) addToLibrary(sample, "sample");
}

export function libraryStats(): { total: number; fromPeople: number } {
  seedLibrary();
  const row = database()
    .prepare("SELECT COUNT(*) AS total, SUM(source = 'user') AS people FROM library")
    .get() as { total: number; people: number | null };
  return { total: row.total, fromPeople: row.people ?? 0 };
}

export async function findInLibrary(
  query: string,
  limit = 4,
): Promise<{ entry: LibraryEntry; source: string }[]> {
  seedLibrary();
  const rows = database().prepare("SELECT * FROM library LIMIT 500").all() as LibraryRow[];
  return (await rank("library", rows, query, limit)).map((r) => ({
    entry: JSON.parse(r.summary),
    source: r.source,
  }));
}
