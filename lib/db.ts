import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  locale TEXT NOT NULL DEFAULT 'en',
  role TEXT NOT NULL DEFAULT 'learner',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  language TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  source TEXT NOT NULL,
  goal TEXT,
  content TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lessons_user ON lessons(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hints (
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  level INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (lesson_id, step_index, level)
);

CREATE TABLE IF NOT EXISTS translations (
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (lesson_id, locale)
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  code TEXT NOT NULL,
  passed INTEGER NOT NULL,
  results TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_lesson ON attempts(lesson_id, step_index, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS ai_cache (
  key TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_activity (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  actions INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  day TEXT NOT NULL,
  provider_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, kind, day)
);

CREATE TABLE IF NOT EXISTS content_packs (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL,
  pack TEXT NOT NULL,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_status ON content_packs(status, version DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS plugin_events (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  hook TEXT NOT NULL,
  ok INTEGER NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plugin_events_time ON plugin_events(created_at DESC);
`;

/**
 * Open (and migrate) a SQLite database using Node's built-in driver.
 * Pass ":memory:" for tests.
 */
export function createDb(
  path: string = process.env.DATABASE_PATH ?? ".data/codequest.db",
): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Add columns that predate an existing database file. */
function migrate(db: Db): void {
  const columns = db
    .prepare("PRAGMA table_info(users)")
    .all() as unknown as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "role")) {
    db.exec(
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'learner'",
    );
  }
}

let singleton: Db | null = null;

export function getDb(): Db {
  singleton ??= createDb();
  return singleton;
}

/** Test helper: drop the process-wide handle. */
export function resetDb(): void {
  singleton?.close();
  singleton = null;
}

export function nowIso(date: Date = new Date()): string {
  return date.toISOString();
}

/** UTC day key (YYYY-MM-DD) used for streaks and email gating. */
export function todayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function newId(): string {
  return randomUUID();
}

export type UserRole = "learner" | "developer";

export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  locale: string;
  role: UserRole;
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  locale: string;
  role: string | null;
  created_at: string;
}

function toUser(row: UserRow | undefined): UserRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    locale: row.locale,
    role: row.role === "developer" ? "developer" : "learner",
    createdAt: row.created_at,
  };
}

export function findUserByEmail(db: Db, email: string): UserRecord | null {
  const row = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  return toUser(row);
}

export function findUserById(db: Db, id: string): UserRecord | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
  return toUser(row);
}

export function createUser(
  db: Db,
  input: {
    email: string;
    name?: string | null;
    locale?: string;
    role?: UserRole;
  },
  now: Date = new Date(),
): UserRecord {
  const user: UserRecord = {
    id: newId(),
    email: input.email.trim().toLowerCase(),
    name: input.name?.trim() || null,
    locale: input.locale ?? "en",
    role: input.role ?? "learner",
    createdAt: nowIso(now),
  };
  db.prepare(
    "INSERT INTO users (id, email, name, locale, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    user.id,
    user.email,
    user.name,
    user.locale,
    user.role,
    user.createdAt,
  );
  return user;
}

export function setUserRole(
  db: Db,
  userId: string,
  role: UserRole,
): UserRecord | null {
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
  return findUserById(db, userId);
}

export function upsertUserByEmail(
  db: Db,
  email: string,
  name?: string | null,
): UserRecord {
  const existing = findUserByEmail(db, email);
  if (existing) return existing;
  return createUser(db, { email, name });
}

export function listUsers(db: Db): UserRecord[] {
  const rows = db
    .prepare("SELECT * FROM users ORDER BY created_at ASC")
    .all() as unknown as UserRow[];
  return rows.map((row) => toUser(row) as UserRecord);
}
