export const FEATURE_FLAG_NAMES = [
  "githubImport",
  "streakEmails",
  "plugins",
  "contentUpdates",
  "pwaUpdates",
  "translations",
] as const;

export type FeatureFlag = (typeof FEATURE_FLAG_NAMES)[number];
export type FeatureFlags = Record<FeatureFlag, boolean>;

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  githubImport: true,
  streakEmails: true,
  plugins: true,
  contentUpdates: true,
  pwaUpdates: true,
  translations: true,
};

/**
 * Flags come from a single JSON env var, e.g.
 * FEATURE_FLAGS={"githubImport":false,"plugins":false}
 * Unknown keys are ignored and malformed JSON falls back to the defaults, so a
 * bad env var can never take the app down.
 */
export function parseFeatureFlags(raw: string | undefined): FeatureFlags {
  if (!raw) return { ...DEFAULT_FEATURE_FLAGS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_FEATURE_FLAGS };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DEFAULT_FEATURE_FLAGS };
  }

  const flags = { ...DEFAULT_FEATURE_FLAGS };
  const record = parsed as Record<string, unknown>;
  for (const name of FEATURE_FLAG_NAMES) {
    if (typeof record[name] === "boolean") {
      flags[name] = record[name] as boolean;
    }
  }
  return flags;
}

export function getFeatureFlags(
  env: NodeJS.ProcessEnv = process.env,
): FeatureFlags {
  return parseFeatureFlags(env.FEATURE_FLAGS);
}

export function isFeatureEnabled(
  flag: FeatureFlag,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getFeatureFlags(env)[flag];
}
