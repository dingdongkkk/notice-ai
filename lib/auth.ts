import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { database } from "./db";

const COOKIE = "nta_session";
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

export type User = { id: number; username: string };

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
      "SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires > ?",
    )
    .get(sha(token), Date.now()) as User | undefined;
  return row ? { id: row.id, username: row.username } : null;
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
