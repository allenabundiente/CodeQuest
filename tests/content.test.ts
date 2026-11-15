import assert from "node:assert/strict";
import test from "node:test";
import { authorizeDeveloper } from "../lib/authz";
import { BUNDLED_PACK } from "../lib/content/bundled";
import type { ContentPack } from "../lib/content/schema";
import {
  exportContent,
  importContent,
  loadActiveContent,
  loadAdminState,
  publishDraft,
  rollbackToVersion,
  saveDraft,
} from "../lib/content/store";
import type { DeveloperContext } from "../lib/authz";
import { createUser, newId, nowIso, upsertUserByEmail } from "../lib/db";
import type { Db } from "../lib/db";
import {
  ensureDeveloperUser,
  syncDeveloperRole,
} from "../lib/developer";
import { BadRequestError, ConfigurationError, ForbiddenError } from "../lib/errors";
import { scopeDeveloperTable } from "../lib/policy";
import { makeDb } from "./helpers";

function clonePack(pack: ContentPack): ContentPack {
  return JSON.parse(JSON.stringify(pack)) as ContentPack;
}

function developerContext(db: Db): DeveloperContext {
  return authorizeDeveloper(
    createUser(db, { email: "dev@example.com", name: "Dev", role: "developer" }),
  );
}

function insertVersion(
  db: Db,
  version: number,
  status: string,
  pack: unknown,
): void {
  db.prepare(
    `INSERT INTO content_packs (id, version, status, pack, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, NULL, NULL, ?)`,
  ).run(newId(), version, status, JSON.stringify(pack), nowIso());
}

test("serves the bundled pack when nothing is published", () => {
  const db = makeDb();
  const active = loadActiveContent(db);
  assert.equal(active.source, "bundled");
  assert.equal(active.version, null);
  assert.equal(active.fallbackReason, null);
  assert.equal(active.pack.copy.brandName, BUNDLED_PACK.copy.brandName);
});

test("falls back to the bundled pack when published content is invalid", () => {
  const db = makeDb();
  insertVersion(db, 1, "published", { schemaVersion: 1, copy: {} });

  const active = loadActiveContent(db);
  assert.equal(active.source, "bundled");
  assert.equal(active.version, null);
  assert.match(active.fallbackReason ?? "", /invalid/i);
  assert.equal(active.pack.copy.brandName, BUNDLED_PACK.copy.brandName);
});

test("only a developer can mint a scoped data context", () => {
  const db = makeDb();
  const learner = createUser(db, { email: "learner@example.com" });
  assert.throws(() => authorizeDeveloper(learner), ForbiddenError);

  const context = developerContext(db);
  assert.doesNotThrow(() =>
    scopeDeveloperTable(context, "content_packs", "write"),
  );

  assert.throws(
    () =>
      scopeDeveloperTable(
        null as unknown as DeveloperContext,
        "content_packs",
        "read",
      ),
    ForbiddenError,
  );
});

test("draft, publish, version history, rollback, and audit form one lifecycle", () => {
  const db = makeDb();
  const context = developerContext(db);

  const v1 = saveDraft(context, db, { pack: BUNDLED_PACK, notes: "initial" });
  assert.equal(v1.version, 1);
  assert.equal(v1.status, "draft");
  assert.equal(loadActiveContent(db).source, "bundled");

  const published1 = publishDraft(context, db);
  assert.equal(published1.status, "published");
  const live = loadActiveContent(db);
  assert.equal(live.source, "remote");
  assert.equal(live.version, 1);

  const edited = clonePack(BUNDLED_PACK);
  edited.copy.dashboardTitle = "Console edited title";
  const v2 = saveDraft(context, db, { pack: edited, notes: "second" });
  assert.equal(v2.version, 2);

  publishDraft(context, db);
  const live2 = loadActiveContent(db);
  assert.equal(live2.version, 2);
  assert.equal(live2.pack.copy.dashboardTitle, "Console edited title");

  const state = loadAdminState(context, db);
  assert.equal(state.history.length, 2);
  assert.equal(state.published?.version, 2);
  assert.ok(state.audit.some((entry) => entry.action === "content.publish"));

  const restored = rollbackToVersion(context, db, 1);
  assert.equal(restored.version, 3);
  assert.equal(restored.status, "published");

  const live3 = loadActiveContent(db);
  assert.equal(live3.version, 3);
  assert.equal(
    live3.pack.copy.dashboardTitle,
    BUNDLED_PACK.copy.dashboardTitle,
  );
  assert.ok(
    loadAdminState(context, db).audit.some(
      (entry) => entry.action === "content.rollback",
    ),
  );
});

test("rejects invalid packs and rollback targets", () => {
  const db = makeDb();
  const context = developerContext(db);

  assert.throws(
    () => saveDraft(context, db, { pack: { schemaVersion: 1 } }),
    BadRequestError,
  );

  saveDraft(context, db, { pack: BUNDLED_PACK });
  assert.throws(
    () => rollbackToVersion(context, db, 99),
    /was not found/i,
  );
});

test("content export and import round-trip through the draft pipeline", () => {
  const db = makeDb();
  const context = developerContext(db);

  const exported = exportContent(context, db);
  assert.equal(exported.kind, "codequest-content-pack");
  assert.equal(exported.source, "bundled");
  assert.equal(exported.version, null);

  const imported = clonePack(exported.pack);
  imported.copy.tagline = "Imported tagline from the CLI";
  const result = importContent(context, db, {
    pack: imported,
    publish: true,
    notes: "from CLI",
  });

  assert.equal(result.draftVersion, 1);
  assert.equal(result.publishedVersion, 1);

  const live = loadActiveContent(db);
  assert.equal(live.source, "remote");
  assert.equal(live.pack.copy.tagline, "Imported tagline from the CLI");
  assert.ok(
    loadAdminState(context, db).audit.some(
      (entry) => entry.action === "content.import",
    ),
  );
});

test("DEVELOPER_EMAILS grants the role on login and bootstraps the CLI", () => {
  const db = makeDb();
  const env = {
    DEVELOPER_EMAILS: "boss@example.com",
  } as unknown as NodeJS.ProcessEnv;

  const user = upsertUserByEmail(db, "boss@example.com");
  assert.equal(user.role, "learner");

  const synced = syncDeveloperRole(db, user, env);
  assert.equal(synced.role, "developer");

  const cliUser = ensureDeveloperUser(db, env);
  assert.equal(cliUser.email, "boss@example.com");
  assert.equal(cliUser.role, "developer");

  assert.throws(
    () => ensureDeveloperUser(db, {} as unknown as NodeJS.ProcessEnv),
    ConfigurationError,
  );
});
