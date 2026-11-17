import type { Db, UserRecord } from "./db";
import { listUsers, todayKey } from "./db";
import { computeStreak, streakSummary } from "./streaks";
import type { StreakSummary } from "./types";

export interface LeaderboardEntry {
  id: string;
  name: string;
  streak: number;
  isCurrentUser: boolean;
}

export interface DailyQuest {
  title: string;
  detail: string;
  done: boolean;
  progress: number;
  total: number;
}

export interface DashboardRailData {
  streak: StreakSummary;
  dailyQuest: DailyQuest;
  leaderboard: LeaderboardEntry[];
}

function displayName(user: UserRecord): string {
  const first = user.name?.trim().split(/\s+/)[0];
  return first || "Learner";
}

/**
 * Small, deterministic sidebar model. Leaderboard is computed from the same
 * daily_activity rows as streaks, so it works without a separate analytics
 * table or background job.
 */
export function buildDashboardRail(
  db: Db,
  user: UserRecord,
  now: Date = new Date(),
): DashboardRailData {
  const today = todayKey(now);
  const streak = streakSummary(db, user.id, now);
  const dayRows = db
    .prepare("SELECT user_id, day FROM daily_activity ORDER BY day DESC")
    .all() as unknown as Array<{ user_id: string; day: string }>;

  const daysByUser = new Map<string, string[]>();
  for (const row of dayRows) {
    const days = daysByUser.get(row.user_id) ?? [];
    days.push(row.day);
    daysByUser.set(row.user_id, days);
  }

  const leaderboard = listUsers(db)
    .map((entry) => ({
      id: entry.id,
      name: displayName(entry),
      streak: computeStreak(daysByUser.get(entry.id) ?? [], today),
      isCurrentUser: entry.id === user.id,
    }))
    .sort((left, right) => {
      if (right.streak !== left.streak) return right.streak - left.streak;
      if (left.isCurrentUser !== right.isCurrentUser) {
        return left.isCurrentUser ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, 5);

  const done = streak.activeToday;
  return {
    streak,
    dailyQuest: {
      title: done ? "Daily quest complete" : "Today's daily quest",
      detail: done
        ? "You showed up today. One more step keeps the momentum."
        : "Run one test or finish one step to keep your streak alive.",
      done,
      progress: done ? 1 : 0,
      total: 1,
    },
    leaderboard,
  };
}
