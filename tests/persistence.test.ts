import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, findUserByEmail } from "../lib/db";
import {
  databaseSignature,
  resolvePersistenceConfig,
  restoreSnapshot,
  snapshotDatabase,
  type PersistenceConfig,
} from "../lib/persistence";

function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "codequest-persistence-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

interface MockState {
  bucket: boolean;
  object: Buffer | null;
  bucketCreates: number;
  uploads: number;
  headers: Record<string, string | string[] | undefined>;
  failGets: number;
  failUploads: number;
}

async function mockSupabase() {
  const state: MockState = {
    bucket: false,
    object: null,
    bucketCreates: 0,
    uploads: 0,
    headers: {},
    failGets: 0,
    failUploads: 0,
  };
  const bucket = "codequest";
  const object = "snap.db";
  const objectPath = `/storage/v1/object/${bucket}/${object}`;
  const bucketPath = `/storage/v1/bucket/${bucket}`;

  const server = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path === bucketPath && request.method === "GET") {
        response.writeHead(state.bucket ? 200 : 404, {
          "content-type": "application/json",
        });
        response.end(JSON.stringify(state.bucket ? { id: bucket } : {}));
        return;
      }
      if (path === "/storage/v1/bucket" && request.method === "POST") {
        await readBody(request);
        state.bucket = true;
        state.bucketCreates += 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ name: bucket }));
        return;
      }
      if (path === objectPath && request.method === "POST") {
        if (state.failUploads > 0) {
          state.failUploads -= 1;
          await readBody(request);
          response.writeHead(500, { "content-type": "application/json" });
          response.end("{}");
          return;
        }
        state.object = await readBody(request);
        state.uploads += 1;
        state.headers = request.headers;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ key: object }));
        return;
      }
      if (path === objectPath && request.method === "GET") {
        if (state.failGets > 0) {
          state.failGets -= 1;
          response.writeHead(500, { "content-type": "application/json" });
          response.end("{}");
          return;
        }
        if (!state.bucket || !state.object) {
          response.writeHead(404, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "not found" }));
          return;
        }
        response.writeHead(200, {
          "content-type": "application/octet-stream",
        });
        response.end(state.object);
        return;
      }
      response.writeHead(404).end();
    },
  );

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    state,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function baseConfig(url: string, databasePath: string): PersistenceConfig {
  return {
    url,
    serviceRoleKey: "test-service-role-key",
    bucket: "codequest",
    object: "snap.db",
    databasePath,
    intervalMs: 5_000,
    debounceMs: 250,
  };
}

test("Supabase config is optional but partial configuration is an error", () => {
  assert.equal(resolvePersistenceConfig({}), null);
  assert.throws(
    () =>
      resolvePersistenceConfig({
        SUPABASE_URL: "https://example.supabase.co",
      }),
    /SUPABASE_SERVICE_ROLE_KEY/,
  );

  const config = resolvePersistenceConfig({
    SUPABASE_URL: "https://example.supabase.co/",
    SUPABASE_SERVICE_ROLE_KEY: "key",
    DATABASE_PATH: "/tmp/codequest.db",
  });
  assert.equal(config?.url, "https://example.supabase.co");
  assert.equal(config?.bucket, "codequest");
  assert.equal(config?.object, "codequest.db");
  assert.equal(config?.intervalMs, 30_000);
});

test("snapshot round-trips accounts through Supabase Storage", async () => {
  const source = tempDir();
  const target = tempDir();
  const mock = await mockSupabase();
  const sourcePath = join(source.dir, "source.db");
  const targetPath = join(target.dir, "restored.db");
  const db = createDb(sourcePath);

  try {
    db.prepare(
      "INSERT INTO users (id, email, name, locale, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "user-1",
      "learner@example.com",
      "Learner",
      "en",
      "learner",
      "2026-01-01T00:00:00.000Z",
    );

    const size = await snapshotDatabase(
      baseConfig(mock.url, sourcePath),
      db,
      fetch,
    );
    assert.ok(size > 0);
    assert.equal(mock.state.uploads, 1);
    assert.equal(mock.state.bucketCreates, 1);
    assert.equal(mock.state.headers["x-upsert"], "true");
    assert.equal(
      mock.state.headers.authorization,
      "Bearer test-service-role-key",
    );
    assert.ok(mock.state.object);
    assert.equal(
      mock.state.object.subarray(0, 16).toString("latin1"),
      "SQLite format 3\u0000",
    );

    const restored = await restoreSnapshot(
      baseConfig(mock.url, targetPath),
      fetch,
    );
    assert.equal(restored, true);
    assert.ok(readFileSync(targetPath).length > 0);

    const reopened = createDb(targetPath);
    try {
      const user = findUserByEmail(reopened, "learner@example.com");
      assert.equal(user?.name, "Learner");
      assert.equal(user?.role, "learner");
    } finally {
      reopened.close();
    }

    assert.equal(
      await restoreSnapshot(baseConfig(mock.url, targetPath), fetch),
      false,
    );
  } finally {
    db.close();
    await mock.close();
    source.cleanup();
    target.cleanup();
  }
});

test("a missing snapshot starts a new database and retries transient errors", async () => {
  const temp = tempDir();
  const mock = await mockSupabase();
  const databasePath = join(temp.dir, "empty.db");

  try {
    mock.state.failGets = 2;
    assert.equal(
      await restoreSnapshot(baseConfig(mock.url, databasePath), fetch),
      false,
    );
    assert.equal(mock.state.failGets, 0);
  } finally {
    await mock.close();
    temp.cleanup();
  }
});

test("a corrupt remote snapshot is rejected instead of opened", async () => {
  const temp = tempDir();
  const mock = await mockSupabase();
  const databasePath = join(temp.dir, "corrupt.db");
  mock.state.bucket = true;
  mock.state.object = Buffer.from("not a sqlite database");

  try {
    await assert.rejects(
      restoreSnapshot(baseConfig(mock.url, databasePath), fetch),
      /valid SQLite/,
    );
  } finally {
    await mock.close();
    temp.cleanup();
  }
});

test("database signature changes after a write", () => {
  const temp = tempDir();
  const path = join(temp.dir, "signature.db");
  const db = createDb(path);
  try {
    const before = databaseSignature(path);
    db.prepare(
      "INSERT INTO users (id, email, name, locale, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "user-2",
      "second@example.com",
      null,
      "en",
      "learner",
      new Date().toISOString(),
    );
    assert.notEqual(databaseSignature(path), before);
  } finally {
    db.close();
    temp.cleanup();
  }
});

test("snapshot upload errors are surfaced", async () => {
  const temp = tempDir();
  const mock = await mockSupabase();
  const path = join(temp.dir, "error.db");
  const db = createDb(path);
  try {
    mock.state.failUploads = 3;
    await assert.rejects(
      snapshotDatabase(baseConfig(mock.url, path), db, fetch),
      /upload failed/,
    );
  } finally {
    db.close();
    await mock.close();
    temp.cleanup();
  }
});

test("a local database is not overwritten by the remote snapshot", async () => {
  const temp = tempDir();
  const mock = await mockSupabase();
  const path = join(temp.dir, "local.db");
  const db = createDb(path);
  db.close();
  writeFileSync(path, "local-state");
  mock.state.bucket = true;
  mock.state.object = Buffer.from("remote-state");

  try {
    assert.equal(
      await restoreSnapshot(baseConfig(mock.url, path), fetch),
      false,
    );
    assert.equal(readFileSync(path, "utf8"), "local-state");
  } finally {
    await mock.close();
    temp.cleanup();
  }
});
