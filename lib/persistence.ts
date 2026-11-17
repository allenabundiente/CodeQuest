import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getRawDb, type Db } from "./db";
import { setDbDirtyHandler } from "./persistence-state";

const SQLITE_MAGIC = "SQLite format 3\u0000";
const DEFAULT_BUCKET = "codequest";
const DEFAULT_OBJECT = "codequest.db";
const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_DEBOUNCE_MS = 1_000;

export type FetchLike = typeof fetch;

export interface PersistenceConfig {
  url: string;
  serviceRoleKey: string;
  bucket: string;
  object: string;
  databasePath: string;
  intervalMs: number;
  debounceMs: number;
}

export interface PersistenceStatus {
  enabled: boolean;
  snapshot: string | null;
  restoredAtBoot: boolean;
  lastUploadAt: string | null;
  lastError: string | null;
}

function positiveInt(value: string | undefined, fallback: number, min: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? Math.floor(parsed) : fallback;
}

function safePathSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9._/-]+$/.test(value) || value.includes("..")) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return value;
}

/**
 * Supabase is enabled only when both the project URL and the service-role key
 * are present. Supplying one without the other fails instead of silently
 * falling back to an ephemeral SQLite file.
 */
export function resolvePersistenceConfig(
  env: Record<string, string | undefined> = process.env,
): PersistenceConfig | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url && !serviceRoleKey) return null;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase persistence requires both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("SUPABASE_URL must use http or https");
  }

  const databasePath = env.DATABASE_PATH ?? ".data/codequest.db";
  if (databasePath === ":memory:") return null;

  return {
    url,
    serviceRoleKey,
    bucket: safePathSegment(
      env.SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_BUCKET,
      "SUPABASE_STORAGE_BUCKET",
    ),
    object: safePathSegment(
      (env.SUPABASE_SNAPSHOT_PATH?.trim() || DEFAULT_OBJECT).replace(/^\/+/, ""),
      "SUPABASE_SNAPSHOT_PATH",
    ),
    databasePath,
    intervalMs: positiveInt(
      env.PERSIST_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
      5_000,
    ),
    debounceMs: positiveInt(
      env.PERSIST_DEBOUNCE_MS,
      DEFAULT_DEBOUNCE_MS,
      250,
    ),
  };
}

function authHeaders(config: PersistenceConfig): Record<string, string> {
  return {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
  };
}

function bucketUrl(config: PersistenceConfig): string {
  return `${config.url}/storage/v1/bucket/${encodeURIComponent(config.bucket)}`;
}

function objectUrl(config: PersistenceConfig): string {
  const object = config.object
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/${object}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(
  url: string,
  init: NonNullable<Parameters<typeof fetch>[1]>,
  fetchImpl: FetchLike,
  attempts = 3,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(20_000),
      });
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < attempts - 1
      ) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < attempts - 1) await sleep(250 * 2 ** attempt);
    }
  }
  throw lastError ?? new Error("Supabase request failed");
}

async function bucketExists(
  config: PersistenceConfig,
  fetchImpl: FetchLike,
): Promise<boolean> {
  const response = await request(
    bucketUrl(config),
    { headers: authHeaders(config), cache: "no-store" },
    fetchImpl,
  );
  if (response.ok) return true;
  if (response.status === 404) return false;
  const body = await response.text();
  if (
    response.status === 400 &&
    /not[ _-]?found|does not exist/i.test(body)
  ) {
    return false;
  }
  throw new Error(`Supabase bucket check failed (${response.status})`);
}

async function ensureBucket(
  config: PersistenceConfig,
  fetchImpl: FetchLike,
): Promise<void> {
  if (await bucketExists(config, fetchImpl)) return;

  const response = await request(
    `${config.url}/storage/v1/bucket`,
    {
      method: "POST",
      headers: {
        ...authHeaders(config),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: config.bucket,
        name: config.bucket,
        public: false,
      }),
    },
    fetchImpl,
  );
  if (response.ok) return;
  const body = await response.text();
  if (/already exists|duplicate/i.test(body)) return;
  throw new Error(`Supabase bucket creation failed (${response.status})`);
}

async function downloadSnapshot(
  config: PersistenceConfig,
  fetchImpl: FetchLike,
): Promise<Buffer | null> {
  const response = await request(
    objectUrl(config),
    { headers: authHeaders(config), cache: "no-store" },
    fetchImpl,
  );
  if (response.status === 404) return null;
  if (response.status === 400) {
    const body = await response.text();
    if (/not[ _-]?found|does not exist/i.test(body)) return null;
    throw new Error(`Supabase snapshot download failed (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`Supabase snapshot download failed (${response.status})`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length < SQLITE_MAGIC.length ||
    bytes.subarray(0, SQLITE_MAGIC.length).toString("latin1") !== SQLITE_MAGIC
  ) {
    throw new Error("Supabase snapshot is not a valid SQLite database");
  }
  return bytes;
}

/**
 * Restore the last Supabase snapshot before the app opens SQLite. An existing
 * local file wins so a warm process restart does not discard newer writes.
 */
export async function restoreSnapshot(
  config: PersistenceConfig | null,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  if (!config) return false;
  if (
    existsSync(config.databasePath) &&
    statSync(config.databasePath).size > 0
  ) {
    return false;
  }

  const bytes = await downloadSnapshot(config, fetchImpl);
  if (!bytes) return false;

  mkdirSync(dirname(config.databasePath), { recursive: true });
  const temporary = `${config.databasePath}.restore-${process.pid}`;
  writeFileSync(temporary, bytes, { mode: 0o600 });
  renameSync(temporary, config.databasePath);
  rmSync(`${config.databasePath}-wal`, { force: true });
  rmSync(`${config.databasePath}-shm`, { force: true });
  return true;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Create a consistent SQLite copy with `VACUUM INTO` and upload it as a
 * private Supabase Storage object. Returns the uploaded byte count.
 */
export async function snapshotDatabase(
  config: PersistenceConfig,
  db: Db = getRawDb(),
  fetchImpl: FetchLike = fetch,
): Promise<number> {
  const temporary = join(
    tmpdir(),
    `codequest-snapshot-${process.pid}-${Date.now()}.db`,
  );
  rmSync(temporary, { force: true });

  try {
    db.exec(`VACUUM INTO ${sqlString(temporary)}`);
    const bytes = readFileSync(temporary);
    if (
      bytes.length < SQLITE_MAGIC.length ||
      bytes.subarray(0, SQLITE_MAGIC.length).toString("latin1") !== SQLITE_MAGIC
    ) {
      throw new Error("Snapshot is not a valid SQLite database");
    }

    await ensureBucket(config, fetchImpl);
    const response = await request(
      objectUrl(config),
      {
        method: "POST",
        headers: {
          ...authHeaders(config),
          "content-type": "application/octet-stream",
          "cache-control": "no-store",
          "x-upsert": "true",
        },
        body: new Uint8Array(bytes),
      },
      fetchImpl,
    );
    if (!response.ok) {
      throw new Error(`Supabase snapshot upload failed (${response.status})`);
    }
    return bytes.length;
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** File signature used to skip uploads when nothing changed. */
export function databaseSignature(databasePath: string): string {
  return [databasePath, `${databasePath}-wal`]
    .map((path) => {
      try {
        const stat = statSync(path);
        return `${stat.size}:${stat.mtimeMs}`;
      } catch {
        return "0";
      }
    })
    .join("|");
}

type GlobalWithPersistence = typeof globalThis & {
  __codequestPersistenceStatus?: PersistenceStatus;
};

function sharedStatus(): PersistenceStatus {
  const store = (globalThis as GlobalWithPersistence);
  store.__codequestPersistenceStatus ??= {
    enabled: false,
    snapshot: null,
    restoredAtBoot: false,
    lastUploadAt: null,
    lastError: null,
  };
  return store.__codequestPersistenceStatus;
}

let currentConfig: PersistenceConfig | null = null;
let started = false;
let shuttingDown = false;
let interval: NodeJS.Timeout | null = null;
let debounce: NodeJS.Timeout | null = null;
let inFlight: Promise<boolean> | null = null;
let lastSignature = "";

function scheduleFlush(): void {
  if (!started || shuttingDown || !currentConfig) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void flushPersistence();
  }, currentConfig.debounceMs);
  debounce.unref();
}

async function flushPersistence(force = false): Promise<boolean> {
  const config = currentConfig;
  if (!config) return false;
  if (inFlight) return inFlight;
  if (!force && databaseSignature(config.databasePath) === lastSignature) {
    return false;
  }

  inFlight = (async () => {
    const before = databaseSignature(config.databasePath);
    try {
      await snapshotDatabase(config, getRawDb());
      lastSignature = databaseSignature(config.databasePath);
      const status = sharedStatus();
      status.lastUploadAt = new Date().toISOString();
      status.lastError = null;
      if (lastSignature !== before) scheduleFlush();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sharedStatus().lastError = message;
      console.error(`[persistence] snapshot upload failed: ${message}`);
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  setDbDirtyHandler(null);
  if (interval) clearInterval(interval);
  if (debounce) clearTimeout(debounce);

  const timeout = setTimeout(() => process.exit(0), 12_000);
  timeout.unref();
  void (async () => {
    if (inFlight) await inFlight;
    await flushPersistence(true);
  })().finally(() => {
    clearTimeout(timeout);
    process.exit(0);
  });
}

/**
 * Restore before opening the app database, then upload after writes. Called
 * from instrumentation once per server process.
 */
export async function startPersistence(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (started) return;
  started = true;

  const config = resolvePersistenceConfig(env);
  const status = sharedStatus();
  if (!config) {
    status.enabled = false;
    if (env.RENDER) {
      console.warn(
        "[persistence] Supabase is not configured; free Render data will be lost on restart",
      );
    }
    return;
  }

  currentConfig = config;
  status.enabled = true;
  status.snapshot = `${config.bucket}/${config.object}`;
  status.lastError = null;
  status.restoredAtBoot = await restoreSnapshot(config, fetchImpl);
  getRawDb();
  lastSignature = databaseSignature(config.databasePath);

  setDbDirtyHandler(scheduleFlush);
  interval = setInterval(() => void flushPersistence(), config.intervalMs);
  interval.unref();
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  scheduleFlush();

  console.info(
    `[persistence] Supabase ${status.restoredAtBoot ? "restored" : "ready"}: ${config.bucket}/${config.object}`,
  );
}

export function persistenceStatus(): PersistenceStatus {
  return { ...sharedStatus() };
}
