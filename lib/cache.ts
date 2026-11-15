import { createHash } from "node:crypto";
import type { Db } from "./db";
import { nowIso } from "./db";
import { SCHEMA_VERSION } from "./schemas";

export interface CacheEntry<T> {
  value: T;
  createdAt: string;
}

export interface CacheStore {
  get<T>(key: string): T | null;
  set(key: string, task: string, value: unknown, ttlSeconds: number): void;
  prune(): number;
}

/**
 * Content-addressed cache for model output. The key covers the prompt, the
 * task name, the schema version and the provider chain, so swapping a model
 * never serves a stale response from a different model.
 */
export function cacheKey(parts: {
  task: string;
  system: string;
  prompt: string;
  providerSignature: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        SCHEMA_VERSION,
        parts.task,
        parts.providerSignature,
        parts.system,
        parts.prompt,
      ]),
    )
    .digest("hex");
}

export function createAiCache(
  db: Db,
  options: { now?: () => Date } = {},
): CacheStore {
  const now = options.now ?? (() => new Date());

  return {
    get<T>(key: string): T | null {
      const row = db
        .prepare("SELECT value, expires_at FROM ai_cache WHERE key = ?")
        .get(key) as { value: string; expires_at: string } | undefined;
      if (!row) return null;
      if (row.expires_at <= nowIso(now())) {
        db.prepare("DELETE FROM ai_cache WHERE key = ?").run(key);
        return null;
      }
      try {
        return JSON.parse(row.value) as T;
      } catch {
        db.prepare("DELETE FROM ai_cache WHERE key = ?").run(key);
        return null;
      }
    },

    set(key, task, value, ttlSeconds) {
      const created = now();
      const expires = new Date(created.getTime() + ttlSeconds * 1000);
      db.prepare(
        `INSERT INTO ai_cache (key, task, value, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           task = excluded.task,
           value = excluded.value,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      ).run(
        key,
        task,
        JSON.stringify(value),
        nowIso(created),
        nowIso(expires),
      );
      this.prune();
    },

    prune(): number {
      const result = db
        .prepare("DELETE FROM ai_cache WHERE expires_at <= ?")
        .run(nowIso(now()));
      return Number(result.changes ?? 0);
    },
  };
}
