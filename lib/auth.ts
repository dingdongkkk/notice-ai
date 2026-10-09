import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { database } from "./db";

const COOKIE = "nta_session";
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

// `name` is the display name from Google; accounts made with a password have none.
export type User = { id: number; username: string; name?: string | null };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const derive = (password: string, salt: string) => scryptSync(password, salt, 64).toString("hex");

// Failed sign-ins per username, kept in memory. Enough to slow guessing on a
// single server; it resets when the server restarts.
const failures = new Map<string, { count: number; until: number }>();

export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== "string" || !/^[a-z0-9_.-]{3,30}$/.test(username.toLowerCase())) {
    return "Choose a username of 3 to 30 letters, numbers, dots, dashes or underscores.";
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    return "Choose a password of at least 8 characters.";
  }
  return null;
}

export function createUser(username: string, password: string): User | null {
  const name = username.toLowerCase();
  const salt = randomBytes(16).toString("hex");
  try {
    const result = database()
      .prepare("INSERT INTO users (username, salt, hash, created) VALUES (?, ?, ?, ?)")
      .run(name, salt, derive(password, salt), new Date().toISOString());
    return { id: Number(result.lastInsertRowid), username: name };
  } catch {
    return null; // The username is taken.
  }
}

// Finds the account for a Google identity, or creates one. The account is
// named by the Google email and has no usable password.
export function userForGoogle(sub: string, email: string, displayName: string | null): User {
  const db = database();
  const shown = displayName?.trim().slice(0, 80) || null;
  const found = db.prepare("SELECT id, username FROM users WHERE google_sub = ?").get(sub) as
    | User
    | undefined;
  if (found) {
    // Keep the name current; people change it in their Google account.
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(shown, found.id);
    return { id: found.id, username: found.username, name: shown };
  }
  // A password account may already use this name; add a suffix if so.
  let name = email.toLowerCase();
  for (let i = 2; db.prepare("SELECT 1 FROM users WHERE username = ?").get(name); i++) {
    name = `${email.toLowerCase()} (${i})`;
  }
  const result = db
    .prepare(
      "INSERT INTO users (username, salt, hash, created, google_sub, name) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      name,
      randomBytes(16).toString("hex"),
      randomBytes(64).toString("hex"),
      new Date().toISOString(),
      sub,
      shown,
    );
  return { id: Number(result.lastInsertRowid), username: name, name: shown };
}

export function googleConfig(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const origin = process.env.APP_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  return { clientId, clientSecret, redirectUri: `${origin}/api/auth/google/callback` };
}

export type SignIn = { user: User } | { error: string; status: number };

export function signIn(username: string, password: string): SignIn {
  const name = String(username).toLowerCase();
  const lock = failures.get(name);
  if (lock && lock.count >= MAX_FAILURES && lock.until > Date.now()) {
    return { error: "Too many wrong attempts. Wait a minute and try again.", status: 429 };
  }
  const row = database()
    .prepare("SELECT id, username, salt, hash FROM users WHERE username = ?")
    .get(name) as { id: number; username: string; salt: string; hash: string } | undefined;
  // Derive a hash even for an unknown username so both cases take the same time.
  const expected = Buffer.from(row?.hash ?? "0".repeat(128), "hex");
  const actual = Buffer.from(derive(String(password), row?.salt ?? "0".repeat(32)), "hex");
  if (!row || !timingSafeEqual(expected, actual)) {
    const count = lock && lock.until > Date.now() ? lock.count + 1 : 1;
    failures.set(name, { count, until: Date.now() + LOCK_MS });
    return { error: "That username and password do not match.", status: 401 };
  }
  failures.delete(name);
  return { user: { id: row.id, username: row.username } };
}

// The browser gets a random token; only its hash is stored.
export function startSession(user: User): string {
  const token = randomBytes(32).toString("hex");
  const db = database();
  db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)").run(
    sha(token),
    user.id,
    Date.now() + WEEK_SECONDS * 1000,
  );
  return token;
}

function tokenFrom(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  const match = header.split(/;\s*/).find((part) => part.startsWith(`${COOKIE}=`));
  return match ? match.slice(COOKIE.length + 1) : null;
}

export function currentUser(req: Request): User | null {
  const token = tokenFrom(req);
  if (!token) return null;
  const row = database()
    .prepare(
      "SELECT users.id, users.username, users.name FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires > ?",
    )
    .get(sha(token), Date.now()) as User | undefined;
  return row ? { id: row.id, username: row.username, name: row.name ?? null } : null;
}

export function endSession(req: Request) {
  const token = tokenFrom(req);
  if (token) database().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token));
}

export function sessionCookie(token: string | null): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return token
    ? `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${WEEK_SECONDS}${secure}`
    : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
