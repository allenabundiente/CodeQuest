import type { ContentPack } from "./schema";
import { validatePack } from "./schema";

export interface StagedContent {
  version: number;
  pack: ContentPack;
}

export type StageResult =
  | { ok: true; staged: StagedContent }
  | { ok: false; error: string };

/**
 * Client-side gate for a background download. A pack is only staged when the
 * response is complete, the version matches what /api/version advertised, and
 * the whole document still validates. Otherwise the currently applied content
 * stays in place.
 */
export function validateStagedContent(
  payload: unknown,
  expectedVersion: number,
): StageResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Downloaded content is not an object." };
  }

  const record = payload as { version?: unknown; pack?: unknown };
  if (
    typeof record.version !== "number" ||
    !Number.isInteger(record.version) ||
    record.version <= 0
  ) {
    return { ok: false, error: "Downloaded content has no valid version." };
  }

  if (expectedVersion > 0 && record.version !== expectedVersion) {
    return {
      ok: false,
      error: `Expected content v${expectedVersion} but received v${record.version}.`,
    };
  }

  const validation = validatePack(record.pack);
  if (!validation.ok || !validation.pack) {
    return {
      ok: false,
      error: `Downloaded content failed validation: ${
        validation.errors.join("; ") || "unknown error"
      }`,
    };
  }

  return {
    ok: true,
    staged: { version: record.version, pack: validation.pack },
  };
}
