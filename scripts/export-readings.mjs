// Copies the readings kept in the local database into lib/seed-readings.json,
// so they can be committed and used on a server whose database is not kept.
//
//   node scripts/export-readings.mjs
//
// The file then holds the facts read from every notice in the database,
// including any names and numbers in them. Read it before committing it to a
// public repository.
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const target = "lib/seed-readings.json";
const seeds = JSON.parse(readFileSync(target, "utf8"));
const known = new Set(seeds.map((s) => `${s.hash}|${s.language}`));
const rows = new DatabaseSync("data/app.db", { readOnly: true })
  .prepare("SELECT hash, language, model, notice FROM readings ORDER BY created")
  .all();
let added = 0;
for (const row of rows) {
  if (known.has(`${row.hash}|${row.language}`)) continue;
  seeds.push({ hash: row.hash, language: row.language, model: row.model, notice: JSON.parse(row.notice) });
  added++;
}
writeFileSync(target, JSON.stringify(seeds, null, 2) + "\n");
console.log(`${added} reading(s) added, ${seeds.length} in ${target}`);
