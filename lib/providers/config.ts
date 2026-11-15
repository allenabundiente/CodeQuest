import { createOpenAiCompatibleProvider } from "./openai-compatible";
import type { Provider, ProviderId } from "./types";

export const PROVIDER_IDS: readonly ProviderId[] = [
  "gemini",
  "deepseek",
  "groq",
];

export interface ProviderRuntimeConfig {
  order: ProviderId[];
  openRouterApiKey: string;
  groqApiKey: string;
  models: Record<ProviderId, string>;
  timeoutMs: number;
  openRouterBaseUrl: string;
  groqBaseUrl: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODELS: Record<ProviderId, string> = {
  gemini: "google/gemini-2.5-flash",
  deepseek: "deepseek/deepseek-chat-v3.1",
  groq: "llama-3.3-70b-versatile",
};

function parseOrder(raw: string | undefined): ProviderId[] {
  const requested = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const order: ProviderId[] = [];
  for (const entry of requested) {
    if ((PROVIDER_IDS as readonly string[]).includes(entry)) {
      order.push(entry as ProviderId);
    }
  }
  if (order.length === 0) return [...PROVIDER_IDS];

  // Always keep the remaining providers available as a last resort.
  for (const id of PROVIDER_IDS) {
    if (!order.includes(id)) order.push(id);
  }
  return order;
}

export function providerConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProviderRuntimeConfig {
  return {
    order: parseOrder(env.PROVIDER_ORDER),
    openRouterApiKey: (env.OPENROUTER_API_KEY ?? "").trim(),
    groqApiKey: (env.GROQ_API_KEY ?? "").trim(),
    models: {
      gemini: (env.GEMINI_MODEL ?? "").trim() || DEFAULT_MODELS.gemini,
      deepseek: (env.DEEPSEEK_MODEL ?? "").trim() || DEFAULT_MODELS.deepseek,
      groq: (env.GROQ_MODEL ?? "").trim() || DEFAULT_MODELS.groq,
    },
    timeoutMs: Number(env.AI_TIMEOUT_MS ?? 45_000),
    openRouterBaseUrl: env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    groqBaseUrl: env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    fetchImpl: undefined,
  };
}

/** Providers that actually have a key, in fallback order. */
export function buildProviders(config: ProviderRuntimeConfig): Provider[] {
  const providers: Provider[] = [];
  for (const id of config.order) {
    if (id === "groq") {
      if (!config.groqApiKey) continue;
      providers.push(
        createOpenAiCompatibleProvider({
          id,
          model: config.models.groq,
          baseUrl: config.groqBaseUrl,
          apiKey: config.groqApiKey,
          timeoutMs: config.timeoutMs,
          fetchImpl: config.fetchImpl,
          headers: { "x-title": "CodeQuest" },
        }),
      );
      continue;
    }

    if (!config.openRouterApiKey) continue;
    providers.push(
      createOpenAiCompatibleProvider({
        id,
        model: config.models[id],
        baseUrl: config.openRouterBaseUrl,
        apiKey: config.openRouterApiKey,
        timeoutMs: config.timeoutMs,
        fetchImpl: config.fetchImpl,
        headers: { "x-title": "CodeQuest" },
      }),
    );
  }
  return providers;
}

export function configuredProviderIds(
  config: ProviderRuntimeConfig = providerConfigFromEnv(),
): ProviderId[] {
  return buildProviders(config).map((provider) => provider.id);
}
