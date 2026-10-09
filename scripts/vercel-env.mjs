// Uploads every setting in .env.local to the linked Vercel project's
// production environment. Run `npx vercel link` first. Values are passed to
// the Vercel CLI directly and are never printed.
//
//   node scripts/vercel-env.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

let failed = 0;
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.+)$/.exec(line.trim());
  if (!match) continue;
  const [, name, value] = match;
  const result = spawnSync("npx", ["vercel", "env", "add", name, "production", "--force"], {
    input: value,
    shell: true,
    stdio: ["pipe", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (result.status === 0) {
    console.log(`${name}: uploaded`);
  } else {
    failed++;
    console.log(`${name}: FAILED\n${(result.stderr || "").trim().split("\n").slice(-2).join("\n")}`);
  }
}
process.exit(failed ? 1 : 0);
