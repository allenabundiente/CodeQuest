import { assertDeveloperContext } from "./authz";
import type { DeveloperContext } from "./authz";
import { ForbiddenError } from "./errors";

/**
 * SQLite does not implement Postgres-style row-level security, so CodeQuest
 * enforces the equivalent at the single data-access boundary: every table that
 * belongs to the developer role is reached only through a scoped query object
 * minted here, and the scope can only be created from a DeveloperContext.
 *
 * Developer rows are global (not owner-scoped), so the predicate is 1=1; the
 * policy table is the place to tighten that if content ever becomes
 * multi-tenant.
 */
export const DEVELOPER_SCOPED_TABLES = [
  "content_packs",
  "audit_log",
  "plugin_events",
] as const;

export type DeveloperScopedTable = (typeof DEVELOPER_SCOPED_TABLES)[number];

export type RowOperation = "read" | "write";

export const ROW_POLICIES: Record<
  DeveloperScopedTable,
  Record<RowOperation, boolean>
> = {
  content_packs: { read: true, write: true },
  audit_log: { read: true, write: true },
  plugin_events: { read: true, write: true },
};

export interface ScopedTable {
  readonly table: DeveloperScopedTable;
  readonly predicate: "1=1";
}

export function scopeDeveloperTable(
  context: DeveloperContext,
  table: DeveloperScopedTable,
  operation: RowOperation = "read",
): ScopedTable {
  assertDeveloperContext(context);
  if (!ROW_POLICIES[table]?.[operation]) {
    throw new ForbiddenError(
      `The developer role cannot ${operation} ${table}.`,
    );
  }
  return Object.freeze({ table, predicate: "1=1" as const });
}
