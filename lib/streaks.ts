import type { Db } from "./db";
import { nowIso, todayKey } from "./db";
import type { EmailClient } from "./email";
import { renderStreakEmail } from "./email";
import type { StreakSummary } from "./types";

export function shiftDay(day: string, deltaDays: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

/** Consecutive active days ending today (or yesterday, if today is still open). */
export function computeStreak(days: string[], today: string = todayKey()): number {
  const unique = new Set(days);
  let cursor = unique.has(today) ? today : shiftDay(today, -1);
  if (!unique.has(cursor)) return 0;

  let streak = 0;
  while (unique.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

export function longestStreak(days: string[]): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    if (previous && shiftDay(previous, 1) === day) {
      run += 1;
    } else {
      run = 1;
    }
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}

export function recordActivity(
  db: Db,
  userId: string,
  day: string = todayKey(),
): void {
  db.prepare(
    `INSERT INTO daily_activity (user_id, day, actions) VALUES (?, ?, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET actions = actions + 1`,
  ).run(userId, day);
}

export function activeDays(db: Db, userId: string): string[] {
  const rows = db
    .prepare(
      "SELECT day FROM daily_activity WHERE user_id = ? ORDER BY day DESC LIMIT 365",
    )
    .all(userId) as Array<{ day: string }>;
  return rows.map((row) => row.day);
}

export function streakSummary(
  db: Db,
  userId: string,
  now: Date = new Date(),
): StreakSummary {
  const today = todayKey(now);
  const days = activeDays(db, userId);
  return {
    current: computeStreak(days, today),
    longest: longestStreak(days),
    activeToday: days.includes(today),
    days: days.slice(0, 30),
  };
}

export interface StreakEmailDeps {
  db: Db;
  email: EmailClient;
  appUrl: string;
  now?: () => Date;
  minStreak?: number;
  /** Optional lesson to deep-link to. */
  pickLesson?: (userId: string) => { id: string; title: string } | null;
}

export interface StreakEmailResult {
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
}

/**
 * One email per user per day, only for learners with an active streak of at
 * least `minStreak` days. Re-running the cron is safe: the email_log unique
 * constraint plus an explicit lookup prevent duplicates.
 */
export async function sendStreakEmails(
  deps: StreakEmailDeps,
): Promise<StreakEmailResult> {
  const now = (deps.now ?? (() => new Date()))();
  const today = todayKey(now);
  const yesterday = shiftDay(today, -1);
  const minStreak = deps.minStreak ?? 2;

  const users = deps.db
    .prepare(
      `SELECT DISTINCT u.id, u.email, u.name
         FROM users u
         JOIN daily_activity a ON a.user_id = u.id
        WHERE a.day IN (?, ?)`,
    )
    .all(today, yesterday) as unknown as UserRow[];

  const result: StreakEmailResult = {
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const row of users) {
    const summary = streakSummary(deps.db, row.id, now);
    if (summary.current < minStreak) {
      result.skipped += 1;
      continue;
    }

    const alreadySent = deps.db
      .prepare(
        "SELECT 1 AS hit FROM email_log WHERE user_id = ? AND kind = 'streak' AND day = ?",
      )
      .get(row.id, today) as { hit: number } | undefined;
    if (alreadySent) {
      result.skipped += 1;
      continue;
    }

    const lesson = deps.pickLesson?.(row.id) ?? null;
    const email = renderStreakEmail({
      name: row.name,
      streak: summary.current,
      appUrl: deps.appUrl,
      lesson,
    });

    try {
      const sent = await deps.email.send({
        to: row.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      deps.db
        .prepare(
          `INSERT OR REPLACE INTO email_log (id, user_id, kind, day, provider_id, status, created_at)
           VALUES (?, ?, 'streak', ?, ?, 'sent', ?)`,
        )
        .run(crypto.randomUUID(), row.id, today, sent.id, nowIso(now));
      result.sent += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push(
        error instanceof Error ? error.message : "unknown email error",
      );
      deps.db
        .prepare(
          `INSERT OR REPLACE INTO email_log (id, user_id, kind, day, provider_id, status, created_at)
           VALUES (?, ?, 'streak', ?, NULL, 'failed', ?)`,
        )
        .run(crypto.randomUUID(), row.id, today, nowIso(now));
    }
  }

  return result;
}
