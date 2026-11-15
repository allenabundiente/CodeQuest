import type { ContentSnapshot } from "./content/types";

export interface ReadinessInput {
  databaseOk: boolean;
  content: ContentSnapshot | null;
  plugins: { total: number; valid: number };
  providers: string[];
  sandbox: { driver: string; url: string };
  now?: Date;
}

export interface ReadinessReport {
  ready: boolean;
  generatedAt: string;
  checks: {
    database: "ok" | "error";
    content: {
      source: "remote" | "bundled";
      version: number | null;
      fallbackReason: string | null;
    };
    plugins: { total: number; valid: number };
    ai: { configured: boolean; providers: string[] };
    sandbox: { driver: string; url: string };
  };
}

/**
 * Readiness = the process can serve the app. External model/sandbox outages are
 * configuration signals, not readiness failures: lesson generation already
 * fails gracefully when they are unavailable.
 */
export function buildReadiness(input: ReadinessInput): ReadinessReport {
  const ready = input.databaseOk && input.content !== null;

  return {
    ready,
    generatedAt: (input.now ?? new Date()).toISOString(),
    checks: {
      database: input.databaseOk ? "ok" : "error",
      content: {
        source: input.content?.source ?? "bundled",
        version: input.content?.version ?? null,
        fallbackReason: input.content?.fallbackReason ?? null,
      },
      plugins: input.plugins,
      ai: {
        configured: input.providers.length > 0,
        providers: input.providers,
      },
      sandbox: input.sandbox,
    },
  };
}
