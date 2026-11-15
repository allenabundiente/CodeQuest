import { createAiCache } from "./cache";
import { getDb } from "./db";
import { createGenerateJson } from "./providers/generate";
import type { GenerateJson } from "./providers/generate";
import {
  buildProviders,
  configuredProviderIds,
  providerConfigFromEnv,
} from "./providers/config";
import type { ProviderId } from "./providers/types";
import { createQuotaService } from "./quota";
import type { QuotaService } from "./quota";

export interface AiRuntime {
  generate: GenerateJson;
  providers: ProviderId[];
  quota: QuotaService;
}

let runtime: AiRuntime | null = null;

function intEnv(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The provider chain, cache and quota share one SQLite handle. Providers with
 * no API key are skipped, so an empty runtime simply reports no providers and
 * generation fails with a clear configuration error.
 */
export function getAi(): AiRuntime {
  if (runtime) return runtime;

  const db = getDb();
  const config = providerConfigFromEnv();
  const providers = buildProviders(config);
  const cache = createAiCache(db);
  const quota = createQuotaService(db, {
    dailyCalls: intEnv(process.env.QUOTA_DAILY_CALLS, 40),
    dailyTokens: intEnv(process.env.QUOTA_DAILY_TOKENS, 200_000),
  });

  runtime = {
    generate: createGenerateJson({
      providers,
      cache,
      quota,
      defaultCacheTtlSeconds: intEnv(
        process.env.AI_CACHE_TTL_SECONDS,
        7 * 24 * 60 * 60,
      ),
    }),
    providers: providers.map((provider) => provider.id),
    quota,
  };
  return runtime;
}

export function resetAiRuntime(): void {
  runtime = null;
}

export function aiProviderIds(): ProviderId[] {
  return configuredProviderIds();
}
