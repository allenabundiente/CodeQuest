import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db, UserRecord } from "./db";
import { findUserById, nowIso } from "./db";

export const SESSION_TTL_DAYS = 30;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedSession {
  token: string;
  expiresAt: string;
}

export function issueSession(
  db: Db,
  userId: string,
  now: Date = new Date(),
): IssuedSession {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000);
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(hashSessionToken(token), userId, nowIso(now), nowIso(expires));
  return { token, expiresAt: nowIso(expires) };
}

export function resolveSession(
  db: Db,
  token: string,
  now: Date = new Date(),
): UserRecord | null {
  if (!token) return null;
  const hash = hashSessionToken(token);
  const row = db
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .get(hash) as { user_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
    return null;
  }
  return findUserById(db, row.user_id);
}

export function revokeSession(db: Db, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(
    hashSessionToken(token),
  );
}

/** Constant-time comparison for cron secrets and similar shared tokens. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
