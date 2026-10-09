import { createHash } from "node:crypto";
import { database } from "./db";
import { parseNotice, type Notice } from "./schema";
import seeds from "./seed-readings.json";

export type Reading = { notice: Notice; model: string; holdSeconds?: number };
type Seed = { hash: string; language: string; model: string; notice: unknown; holdSeconds?: number };

const IMAGE_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

// The fingerprint of an uploaded file, worked out here from its bytes. A
// fingerprint sent by the browser is never trusted, so nobody can file a wrong
// result under someone else's document.
export function fingerprint(dataUrl: unknown): string | null {
  if (typeof dataUrl !== "string") return null;
  const match = IMAGE_URL.exec(dataUrl);
  return match ? createHash("sha256").update(Buffer.from(match[2], "base64")).digest("hex") : null;
}

export function findReading(hashes: string[], language: string): Reading | null {
  if (hashes.length === 0) return null;
  const select = database().prepare(
    "SELECT notice, model FROM readings WHERE hash = ? AND language = ?",
  );
  const seed = (seeds as Seed[]).find((s) => s.language === language && hashes.includes(s.hash));
  const holdSeconds = Math.min(Math.max(Number(seed?.holdSeconds) || 0, 0), 30);
  for (const hash of hashes) {
    const row = select.get(hash, language) as { notice: string; model: string } | undefined;
    if (row) return { notice: JSON.parse(row.notice), model: row.model, holdSeconds };
  }
  return seed ? { notice: parseNotice(seed.notice), model: seed.model, holdSeconds } : null;
}

export function saveReading(hashes: string[], language: string, reading: Reading) {
  const insert = database().prepare(
    "INSERT OR IGNORE INTO readings (hash, language, model, notice, created) VALUES (?, ?, ?, ?, ?)",
  );
  for (const hash of hashes) {
    insert.run(hash, language, reading.model, JSON.stringify(reading.notice), new Date().toISOString());
  }
}

export function findBoxes(hash: string): unknown[] | null {
  const row = database().prepare("SELECT boxes FROM highlights WHERE hash = ?").get(hash) as
    | { boxes: string }
    | undefined;
  return row ? JSON.parse(row.boxes) : null;
}

export function saveBoxes(hash: string, boxes: unknown[]) {
  database()
    .prepare("INSERT OR IGNORE INTO highlights (hash, boxes, created) VALUES (?, ?, ?)")
    .run(hash, JSON.stringify(boxes), new Date().toISOString());
}
