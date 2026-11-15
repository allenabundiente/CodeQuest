import { PluginManifestSchema } from "./schema";
import type {
  HookHandler,
  HookName,
  HookPayloads,
  HookResult,
  HookRunResult,
  PluginDefinition,
  PluginEvent,
  PluginManifest,
  PluginStatus,
} from "./types";
import { HOOK_NAMES } from "./types";

interface Entry {
  manifest: PluginManifest;
  handlers: PluginDefinition["handlers"];
  failures: number;
  disabled: boolean;
  lastError: string | null;
}

export interface RegistryOptions {
  /** Consecutive failures before a plugin is isolated for this process. */
  failureThreshold?: number;
  /** A hanging plugin must not hang lesson generation or publishing. */
  hookTimeoutMs?: number;
  onEvent?: (event: PluginEvent) => void;
}

export interface PluginRegistry {
  runHook<K extends HookName>(
    hook: K,
    payload: HookPayloads[K],
  ): Promise<HookRunResult>;
  status(): PluginStatus[];
  reset(pluginId: string): boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Hook timed out after ${ms}ms.`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeResult(raw: unknown): HookResult {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Hook must return an object or nothing.");
  }
  const record = raw as Record<string, unknown>;
  const result: HookResult = {};
  if (typeof record.ok === "boolean") result.ok = record.ok;
  if (record.messages !== undefined) result.messages = stringList(record.messages);
  if (record.errors !== undefined) result.errors = stringList(record.errors);
  if (record.patch !== undefined) {
    if (
      typeof record.patch !== "object" ||
      record.patch === null ||
      Array.isArray(record.patch)
    ) {
      throw new Error("Hook patch must be a plain object.");
    }
    result.patch = record.patch as Record<string, unknown>;
  }
  return result;
}

/**
 * Loads plugins once, runs hooks with per-plugin isolation, and disables a
 * plugin after repeated failures instead of letting it take the app down.
 */
export function createPluginRegistry(
  definitions: PluginDefinition[],
  options: RegistryOptions = {},
): PluginRegistry {
  const threshold = Math.max(1, options.failureThreshold ?? 3);
  const timeoutMs = Math.max(50, options.hookTimeoutMs ?? 750);
  const entries = new Map<string, Entry>();
  const invalid: PluginStatus[] = [];

  for (const definition of definitions) {
    const candidate = definition.manifest as unknown;
    const parsed = PluginManifestSchema.safeParse(candidate);
    const fallbackId =
      typeof (candidate as { id?: unknown })?.id === "string"
        ? String((candidate as { id: string }).id)
        : "unknown";

    if (!parsed.success) {
      const error = parsed.error.issues
        .slice(0, 6)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      invalid.push({
        id: fallbackId,
        name: fallbackId,
        version: "invalid",
        hooks: [],
        enabled: false,
        disabled: true,
        failures: 0,
        lastError: error,
        valid: false,
        error,
      });
      options.onEvent?.({
        pluginId: fallbackId,
        hook: "manifest",
        ok: false,
        message: error,
      });
      continue;
    }

    const manifest = parsed.data;
    const missingHandler = manifest.hooks.find(
      (hook) => typeof definition.handlers[hook] !== "function",
    );
    if (missingHandler) {
      const error = `Manifest declares ${missingHandler} but no handler is registered.`;
      invalid.push({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        hooks: manifest.hooks,
        enabled: manifest.enabled,
        disabled: true,
        failures: 0,
        lastError: error,
        valid: false,
        error,
      });
      options.onEvent?.({
        pluginId: manifest.id,
        hook: "manifest",
        ok: false,
        message: error,
      });
      continue;
    }

    entries.set(manifest.id, {
      manifest,
      handlers: definition.handlers,
      failures: 0,
      disabled: false,
      lastError: null,
    });
  }

  return {
    async runHook<K extends HookName>(
      hook: K,
      payload: HookPayloads[K],
    ): Promise<HookRunResult> {
      const result: HookRunResult = {
        ok: true,
        messages: [],
        errors: [],
        patch: {},
        failures: [],
      };

      for (const entry of entries.values()) {
        if (
          entry.disabled ||
          !entry.manifest.enabled ||
          !entry.manifest.hooks.includes(hook)
        ) {
          continue;
        }

        const handler = entry.handlers[hook] as
          | HookHandler<K>
          | undefined;
        if (typeof handler !== "function") continue;

        try {
          const raw = await withTimeout(
            Promise.resolve().then(() => handler(payload)),
            timeoutMs,
          );
          const normalized = normalizeResult(raw);

          entry.failures = 0;
          entry.lastError = null;
          result.messages.push(...(normalized.messages ?? []));
          result.errors.push(...(normalized.errors ?? []));
          if (normalized.patch) {
            Object.assign(result.patch, normalized.patch);
          }
          if (normalized.ok === false) result.ok = false;

          options.onEvent?.({
            pluginId: entry.manifest.id,
            hook,
            ok: true,
            message:
              normalized.errors && normalized.errors.length > 0
                ? normalized.errors.join("; ")
                : undefined,
          });
        } catch (error) {
          const message = errorMessage(error);
          entry.failures += 1;
          entry.lastError = message;
          if (entry.failures >= threshold) {
            entry.disabled = true;
          }
          result.failures.push({ pluginId: entry.manifest.id, message });
          options.onEvent?.({
            pluginId: entry.manifest.id,
            hook,
            ok: false,
            message,
          });
        }
      }

      if (result.errors.length > 0) result.ok = false;
      return result;
    },

    status(): PluginStatus[] {
      const live: PluginStatus[] = [...entries.values()].map((entry) => ({
        id: entry.manifest.id,
        name: entry.manifest.name,
        version: entry.manifest.version,
        hooks: [...entry.manifest.hooks],
        enabled: entry.manifest.enabled,
        disabled: entry.disabled,
        failures: entry.failures,
        lastError: entry.lastError,
        valid: true,
      }));
      return [...live, ...invalid];
    },

    reset(pluginId: string): boolean {
      const entry = entries.get(pluginId);
      if (!entry) return false;
      entry.failures = 0;
      entry.disabled = false;
      entry.lastError = null;
      return true;
    },
  };
}

export { HOOK_NAMES };
