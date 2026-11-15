import { getDb, newId, nowIso } from "../db";
import { createPluginRegistry } from "./registry";
import type { PluginRegistry } from "./registry";
import type { HookName, PluginEvent } from "./types";
import { samplePlugins } from "../../plugins/index";

let registry: PluginRegistry | null = null;

function recordEvent(event: PluginEvent): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO plugin_events (id, plugin_id, hook, ok, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId(),
        event.pluginId,
        event.hook,
        event.ok ? 1 : 0,
        event.message?.slice(0, 500) ?? null,
        nowIso(),
      );
  } catch {
    // Plugin telemetry must never break a learner request.
  }
}

/** Process-wide plugin registry with failure isolation and event logging. */
export function getPluginRegistry(): PluginRegistry {
  registry ??= createPluginRegistry(samplePlugins, {
    onEvent: recordEvent,
  });
  return registry;
}

export function resetPluginRegistry(): void {
  registry = null;
}

export interface PluginEventRecord {
  id: string;
  pluginId: string;
  hook: string;
  ok: boolean;
  message: string | null;
  createdAt: string;
}

export function listPluginEvents(limit = 25): PluginEventRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM plugin_events ORDER BY created_at DESC LIMIT ?`,
    )
    .all(Math.min(100, Math.max(1, limit))) as unknown as Array<{
    id: string;
    plugin_id: string;
    hook: string;
    ok: number;
    message: string | null;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    pluginId: row.plugin_id,
    hook: row.hook as HookName | "manifest",
    ok: row.ok === 1,
    message: row.message,
    createdAt: row.created_at,
  }));
}
