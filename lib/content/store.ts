import { assertDeveloperContext } from "../authz";
import type { DeveloperContext } from "../authz";
import type { Db } from "../db";
import { newId, nowIso } from "../db";
import { BadRequestError, NotFoundError } from "../errors";
import { scopeDeveloperTable } from "../policy";
import { BUNDLED_PACK } from "./bundled";
import { validatePack } from "./schema";
import type { ContentPack } from "./schema";
import type {
  ActiveContentSummary,
  AdminState,
  AuditEntry,
  ContentSnapshot,
  DraftVersion,
  ExportPayload,
  VersionStatus,
  VersionSummary,
} from "./types";

interface PackRow {
  id: string;
  version: number;
  status: string;
  pack: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

interface AuditRow {
  id: string;
  actor_email: string | null;
  action: string;
  target: string | null;
  details: string | null;
  created_at: string;
}

function parseStoredPack(
  row: PackRow,
): { pack: ContentPack | null; error: string | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(row.pack);
  } catch {
    return { pack: null, error: "Stored pack is not valid JSON." };
  }
  const validation = validatePack(raw);
  if (!validation.ok || !validation.pack) {
    return {
      pack: null,
      error: validation.errors.join("; ") || "Stored pack is invalid.",
    };
  }
  return { pack: validation.pack, error: null };
}

function summary(row: PackRow): VersionSummary {
  return {
    id: row.id,
    version: row.version,
    status: row.status as VersionStatus,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function latestRow(db: Db, status: VersionStatus): PackRow | null {
  const row = db
    .prepare(
      "SELECT * FROM content_packs WHERE status = ? ORDER BY version DESC LIMIT 1",
    )
    .get(status) as PackRow | undefined;
  return row ?? null;
}

function nextVersion(db: Db): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM content_packs")
    .get() as { version: number } | undefined;
  return (row?.version ?? 0) + 1;
}

/**
 * Public read path. A published pack that fails schema validation is never
 * served: the bundled pack takes over and the reason is surfaced to /admin.
 */
export function loadActiveContent(db: Db): ContentSnapshot {
  const row = latestRow(db, "published");
  if (!row) {
    return {
      source: "bundled",
      version: null,
      pack: BUNDLED_PACK,
      fallbackReason: null,
      publishedAt: null,
    };
  }

  const parsed = parseStoredPack(row);
  if (!parsed.pack) {
    return {
      source: "bundled",
      version: null,
      pack: BUNDLED_PACK,
      fallbackReason: `Published v${row.version} is invalid: ${parsed.error}`,
      publishedAt: row.created_at,
    };
  }

  return {
    source: "remote",
    version: row.version,
    pack: parsed.pack,
    fallbackReason: null,
    publishedAt: row.created_at,
  };
}

function listAuditRows(db: Db, limit = 25): AuditRow[] {
  return db
    .prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?")
    .all(Math.min(100, Math.max(1, limit))) as unknown as AuditRow[];
}

function auditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    action: row.action,
    target: row.target,
    details: row.details,
    actorEmail: row.actor_email,
    createdAt: row.created_at,
  };
}

export function loadAdminState(
  context: DeveloperContext,
  db: Db,
): AdminState {
  scopeDeveloperTable(context, "content_packs", "read");
  scopeDeveloperTable(context, "audit_log", "read");

  const draftRow = latestRow(db, "draft");
  const publishedRow = latestRow(db, "published");

  const draftParsed = draftRow ? parseStoredPack(draftRow) : null;
  const publishedParsed = publishedRow ? parseStoredPack(publishedRow) : null;

  const draft: DraftVersion | null =
    draftRow && draftParsed?.pack
      ? { ...summary(draftRow), pack: draftParsed.pack }
      : null;

  const baseline = draft?.pack ?? publishedParsed?.pack ?? BUNDLED_PACK;
  const baselineSource = draft
    ? "draft"
    : publishedParsed?.pack
      ? "published"
      : "bundled";

  const active = loadActiveContent(db);

  const history = (
    db
      .prepare("SELECT * FROM content_packs ORDER BY version DESC LIMIT 40")
      .all() as unknown as PackRow[]
  ).map(summary);

  return {
    draft,
    published: publishedRow ? summary(publishedRow) : null,
    baseline,
    baselineSource,
    history,
    audit: listAuditRows(db).map(auditEntry),
    active: {
      source: active.source,
      version: active.version,
      fallbackReason: active.fallbackReason,
    },
  };
}

function writeAudit(
  context: DeveloperContext,
  db: Db,
  input: {
    action: string;
    target?: string | null;
    details?: string | null;
  },
): void {
  scopeDeveloperTable(context, "audit_log", "write");
  db.prepare(
    `INSERT INTO audit_log (id, actor_id, actor_email, action, target, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    context.userId,
    context.email,
    input.action,
    input.target ?? null,
    input.details ?? null,
    nowIso(),
  );
}

/** Exposed so admin routes can audit actions that live outside the store. */
export function logAdminAction(
  context: DeveloperContext,
  db: Db,
  input: { action: string; target?: string | null; details?: string | null },
): void {
  assertDeveloperContext(context);
  writeAudit(context, db, input);
}

export interface SaveDraftInput {
  pack: unknown;
  notes?: string | null;
}

export function saveDraft(
  context: DeveloperContext,
  db: Db,
  input: SaveDraftInput,
): DraftVersion {
  assertDeveloperContext(context);
  scopeDeveloperTable(context, "content_packs", "write");

  const validation = validatePack(input.pack);
  if (!validation.ok || !validation.pack) {
    throw new BadRequestError(
      "The content pack is invalid, so it was not saved.",
      validation.errors,
    );
  }

  const pack = validation.pack;
  const draftRow = latestRow(db, "draft");
  const now = nowIso();
  let version: number;

  if (draftRow) {
    version = draftRow.version;
    db.prepare(
      `UPDATE content_packs
          SET pack = ?, notes = ?, created_by = ?, created_at = ?
        WHERE id = ?`,
    ).run(
      JSON.stringify(pack),
      input.notes ?? draftRow.notes,
      context.userId,
      now,
      draftRow.id,
    );
  } else {
    version = nextVersion(db);
    db.prepare(
      `INSERT INTO content_packs (id, version, status, pack, notes, created_by, created_at)
       VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
    ).run(
      newId(),
      version,
      JSON.stringify(pack),
      input.notes ?? null,
      context.userId,
      now,
    );
  }

  writeAudit(context, db, {
    action: "content.draft.save",
    target: `v${version}`,
    details: input.notes ?? null,
  });

  const saved = latestRow(db, "draft");
  const parsed = saved ? parseStoredPack(saved) : null;
  if (!saved || !parsed?.pack) {
    throw new BadRequestError("The draft could not be read back after saving.");
  }
  return { ...summary(saved), pack: parsed.pack };
}

export interface PublishInput {
  notes?: string | null;
}

export function publishDraft(
  context: DeveloperContext,
  db: Db,
  input: PublishInput = {},
): VersionSummary {
  assertDeveloperContext(context);
  scopeDeveloperTable(context, "content_packs", "write");

  const draft = latestRow(db, "draft");
  if (!draft) {
    throw new BadRequestError("There is no draft to publish.");
  }

  const parsed = parseStoredPack(draft);
  if (!parsed.pack) {
    throw new BadRequestError(
      `The draft cannot be published: ${parsed.error ?? "it is invalid."}`,
    );
  }

  const now = nowIso();
  db.prepare("UPDATE content_packs SET status = 'archived' WHERE status = 'published'").run();
  db.prepare(
    `UPDATE content_packs SET status = 'published', notes = ?, created_at = ? WHERE id = ?`,
  ).run(input.notes ?? draft.notes, now, draft.id);

  writeAudit(context, db, {
    action: "content.publish",
    target: `v${draft.version}`,
    details: `Published from draft v${draft.version}`,
  });

  return { ...summary(draft), status: "published", createdAt: now };
}

export function rollbackToVersion(
  context: DeveloperContext,
  db: Db,
  version: number,
): VersionSummary {
  assertDeveloperContext(context);
  scopeDeveloperTable(context, "content_packs", "read");
  scopeDeveloperTable(context, "content_packs", "write");

  const source = db
    .prepare("SELECT * FROM content_packs WHERE version = ?")
    .get(version) as PackRow | undefined;
  if (!source) throw new NotFoundError(`Version ${version} was not found.`);
  if (source.status === "draft") {
    throw new BadRequestError(
      "Drafts cannot be rolled back to; publish them or choose a released version.",
    );
  }

  const parsed = parseStoredPack(source);
  if (!parsed.pack) {
    throw new BadRequestError(
      `Version ${version} is invalid and cannot be restored: ${parsed.error ?? "unknown error"}`,
    );
  }

  const next = nextVersion(db);
  const id = newId();
  const now = nowIso();
  db.prepare("UPDATE content_packs SET status = 'archived' WHERE status = 'published'").run();
  db.prepare(
    `INSERT INTO content_packs (id, version, status, pack, notes, created_by, created_at)
     VALUES (?, ?, 'published', ?, ?, ?, ?)`,
  ).run(
    id,
    next,
    JSON.stringify(parsed.pack),
    `Rollback to v${version}`,
    context.userId,
    now,
  );

  writeAudit(context, db, {
    action: "content.rollback",
    target: `v${next}`,
    details: `Restored content from v${version}`,
  });

  return {
    id,
    version: next,
    status: "published",
    notes: `Rollback to v${version}`,
    createdBy: context.userId,
    createdAt: now,
  };
}

export interface ImportInput {
  pack: unknown;
  publish?: boolean;
  notes?: string | null;
}

export interface ImportResult {
  draftVersion: number;
  publishedVersion: number | null;
}

export function importContent(
  context: DeveloperContext,
  db: Db,
  input: ImportInput,
): ImportResult {
  assertDeveloperContext(context);

  const draft = saveDraft(context, db, {
    pack: input.pack,
    notes: input.notes ?? "Imported pack",
  });

  writeAudit(context, db, {
    action: "content.import",
    target: `v${draft.version}`,
    details: input.publish ? "Imported and published" : "Imported as draft",
  });

  let publishedVersion: number | null = null;
  if (input.publish) {
    const published = publishDraft(context, db, {
      notes: input.notes ?? "Imported pack",
    });
    publishedVersion = published.version;
  }

  return { draftVersion: draft.version, publishedVersion };
}

export function exportContent(
  context: DeveloperContext,
  db: Db,
): ExportPayload {
  assertDeveloperContext(context);
  scopeDeveloperTable(context, "content_packs", "read");

  const active = loadActiveContent(db);
  writeAudit(context, db, {
    action: "content.export",
    target: active.version ? `v${active.version}` : "bundled",
    details: active.source === "bundled" ? "Exported bundled pack" : null,
  });

  return {
    kind: "codequest-content-pack",
    exportedAt: nowIso(),
    source: active.source,
    version: active.version,
    pack: active.pack,
  };
}

export function activeContentSummary(db: Db): ActiveContentSummary {
  const active = loadActiveContent(db);
  return {
    source: active.source,
    version: active.version,
    fallbackReason: active.fallbackReason,
  };
}
