import type { QuotaSnapshot } from "./types";
import type { Db } from "./db";
import { newId, nowIso } from "./db";
import { QuotaExceededError } from "./errors";

export interface QuotaLimits {
  dailyCalls: number;
  dailyTokens: number;
}

export interface UsageEvent {
  userId: string;
  task: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface QuotaService {
  /** Throws QuotaExceededError when the rolling 24h budget is spent. */
  assertAvailable(userId: string): void;
  record(event: UsageEvent): void;
  snapshot(userId: string): QuotaSnapshot;
}

interface UsageRow {
  calls: number;
  tokens: number;
  first: string | null;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Per-user rolling 24h budget. Every successful provider call is recorded, so
 * a user who exhausts their allowance on fallbacks still gets cut off.
 */
export function createQuotaService(
  db: Db,
  limits: QuotaLimits,
  options: { now?: () => Date } = {},
): QuotaService {
  const now = options.now ?? (() => new Date());

  function usage(userId: string): UsageRow {
    const windowStart = nowIso(new Date(now().getTime() - WINDOW_MS));
    const row = db
      .prepare(
        `SELECT COUNT(*) AS calls,
                COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
                MIN(created_at) AS first
           FROM usage_events
          WHERE user_id = ? AND created_at >= ?`,
      )
      .get(userId, windowStart) as UsageRow | undefined;
    return row ?? { calls: 0, tokens: 0, first: null };
  }

  function snapshot(userId: string): QuotaSnapshot {
    const used = usage(userId);
    const resetBase = used.first ? new Date(used.first) : now();
    return {
      usedCalls: used.calls,
      remainingCalls: Math.max(0, limits.dailyCalls - used.calls),
      limitCalls: limits.dailyCalls,
      usedTokens: used.tokens,
      limitTokens: limits.dailyTokens,
      resetAt: nowIso(new Date(resetBase.getTime() + WINDOW_MS)),
    };
  }

  return {
    assertAvailable(userId: string) {
      const used = usage(userId);
      if (used.calls >= limits.dailyCalls) {
        throw new QuotaExceededError(
          `Daily AI quota reached (${limits.dailyCalls} calls). Try again after ${snapshot(userId).resetAt}.`,
          { ...snapshot(userId), reason: "calls" },
        );
      }
      if (used.tokens >= limits.dailyTokens) {
        throw new QuotaExceededError(
          `Daily token budget reached (${limits.dailyTokens} tokens). Try again after ${snapshot(userId).resetAt}.`,
          { ...snapshot(userId), reason: "tokens" },
        );
      }
    },

    record(event: UsageEvent) {
      db.prepare(
        `INSERT INTO usage_events (id, user_id, task, provider, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId(),
        event.userId,
        event.task,
        event.provider,
        Math.max(0, Math.round(event.inputTokens ?? 0)),
        Math.max(0, Math.round(event.outputTokens ?? 0)),
        nowIso(now()),
      );
    },

    snapshot,
  };
}
