/** Inlined into the client bundle at build time; also the server fallback. */
export const APP_VERSION =
  (process.env.NEXT_PUBLIC_APP_VERSION ?? "0.4.0").trim() || "0.4.0";

export const DEFAULT_MIN_SUPPORTED_VERSION = "0.1.0";

export interface VersionInfo {
  appVersion: string;
  contentVersion: number;
  minSupportedVersion: string;
  changelog: string[];
  contentSource: "remote" | "bundled";
  publishedAt: string | null;
  generatedAt: string;
}

/** Numeric semver comparison; prerelease suffixes are ignored. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] =>
    value
      .trim()
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((part) => {
        const parsed = Number.parseInt(part, 10);
        return Number.isFinite(parsed) ? parsed : 0;
      });

  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const first = a[index] ?? 0;
    const second = b[index] ?? 0;
    if (first !== second) return first < second ? -1 : 1;
  }
  return 0;
}

export function isBelowMinimum(
  appVersion: string,
  minSupportedVersion: string,
): boolean {
  return compareVersions(appVersion, minSupportedVersion) < 0;
}

export const APP_CHANGELOG: string[] = [
  "Background content updates: lessons download in the background and apply after the current lesson ends.",
  "Prompt-mode PWA updates with progress-safe reload and a manual check in Settings.",
  "Deploy blueprint, readiness probe, feature flags, and error reporting.",
];

export function buildVersionInfo(input: {
  appVersion: string;
  contentVersion: number;
  minSupportedVersion: string;
  contentChangelog: string[];
  contentSource: "remote" | "bundled";
  publishedAt: string | null;
  now?: Date;
}): VersionInfo {
  const changelog = [...input.contentChangelog, ...APP_CHANGELOG]
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .slice(0, 10);

  return {
    appVersion: input.appVersion,
    contentVersion: input.contentVersion,
    minSupportedVersion: input.minSupportedVersion,
    changelog,
    contentSource: input.contentSource,
    publishedAt: input.publishedAt,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}
