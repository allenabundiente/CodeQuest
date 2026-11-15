import type { ZodType } from "zod";
import type { CacheStore } from "../cache";
import { cacheKey } from "../cache";
import type { QuotaService } from "../quota";
import { ConfigurationError, ProviderUnavailableError } from "../errors";
import type { ChatMessage, Provider, ProviderId } from "./types";
import { ProviderError } from "./types";

export interface ProviderAttempt {
  task: string;
  provider: ProviderId;
  ok: boolean;
  message?: string;
  ms: number;
}

export interface GenerateJsonOptions<T> {
  task: string;
  system: string;
  prompt: string;
  schema: ZodType<T>;
  maxTokens?: number;
  temperature?: number;
  userId?: string;
  cacheTtlSeconds?: number;
  /** Extra model calls allowed to fix invalid JSON on the same provider. */
  repairAttempts?: number;
}

export interface GenerateJsonResult<T> {
  data: T;
  provider: ProviderId;
  model: string;
  cached: boolean;
  attempts: number;
}

export type GenerateJson = <T>(
  options: GenerateJsonOptions<T>,
) => Promise<GenerateJsonResult<T>>;

export interface GenerationDeps {
  providers: Provider[];
  cache?: CacheStore | null;
  quota?: QuotaService | null;
  defaultCacheTtlSeconds?: number;
  now?: () => Date;
  onAttempt?: (attempt: ProviderAttempt) => void;
  /** Injectable for tests; defaults to AbortSignal-free fetch timing. */
  sleep?: (ms: number) => Promise<void>;
}

interface CachedEnvelope<T> {
  data: T;
  provider: ProviderId;
  model: string;
}

export function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export function repairPrompt(issues: string[]): string {
  return [
    "Your previous reply did not satisfy the required JSON schema.",
    "Validation errors:",
    ...issues.slice(0, 8).map((issue) => `- ${issue}`),
    "",
    "Reply again with ONLY one valid JSON object. No markdown fences, no commentary,",
    "and include every required field with the correct types.",
  ].join("\n");
}

function schemaIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string[] {
  return error.issues
    .slice(0, 8)
    .map((issue) => {
      const path = issue.path.length ? issue.path.map(String).join(".") : "(root)";
      return `${path}: ${issue.message}`;
    });
}

export function createGenerateJson(deps: GenerationDeps): GenerateJson {
  const now = deps.now ?? (() => new Date());
  const defaultTtl = deps.defaultCacheTtlSeconds ?? 7 * 24 * 60 * 60;

  return async function generateJson<T>(
    options: GenerateJsonOptions<T>,
  ): Promise<GenerateJsonResult<T>> {
    const providers = deps.providers;
    if (providers.length === 0) {
      throw new ConfigurationError(
        "No AI providers are configured. Set OPENROUTER_API_KEY and/or GROQ_API_KEY.",
      );
    }

    // Quota is charged per provider call, so refuse before doing any work.
    if (options.userId && deps.quota) {
      deps.quota.assertAvailable(options.userId);
    }

    const providerSignature = providers
      .map((provider) => `${provider.id}:${provider.model}`)
      .join(",");
    const key = cacheKey({
      task: options.task,
      system: options.system,
      prompt: options.prompt,
      providerSignature,
    });

    if (deps.cache) {
      const cached = deps.cache.get<CachedEnvelope<T>>(key);
      if (cached && cached.data !== undefined) {
        return {
          data: cached.data,
          provider: cached.provider,
          model: cached.model,
          cached: true,
          attempts: 0,
        };
      }
    }

    const failures: Array<{ provider: ProviderId; message: string }> = [];
    const maxRepairs = options.repairAttempts ?? 1;
    let attempts = 0;

    for (const provider of providers) {
      const messages: ChatMessage[] = [
        { role: "system", content: options.system },
        { role: "user", content: options.prompt },
      ];

      for (let repair = 0; repair <= maxRepairs; repair += 1) {
        attempts += 1;
        const startedAt = Date.now();
        let completion;
        try {
          completion = await provider.complete({
            messages,
            json: true,
            maxTokens: options.maxTokens ?? 3000,
            temperature: options.temperature ?? 0.4,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push({ provider: provider.id, message });
          deps.onAttempt?.({
            task: options.task,
            provider: provider.id,
            ok: false,
            message,
            ms: Date.now() - startedAt,
          });
          // Transport/quota failures move on to the next provider; there is no
          // point retrying the same one and burning the user's budget twice.
          break;
        }

        if (options.userId && deps.quota) {
          deps.quota.record({
            userId: options.userId,
            task: options.task,
            provider: provider.id,
            inputTokens: completion.usage.inputTokens,
            outputTokens: completion.usage.outputTokens,
          });
        }

        const json = extractJsonObject(completion.text);
        if (json) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(json);
          } catch (error) {
            parsed = undefined;
            failures.push({
              provider: provider.id,
              message: error instanceof Error ? error.message : "invalid JSON",
            });
          }

          if (parsed !== undefined) {
            const result = options.schema.safeParse(parsed);
            if (result.success) {
              deps.onAttempt?.({
                task: options.task,
                provider: provider.id,
                ok: true,
                ms: Date.now() - startedAt,
              });
              deps.cache?.set(
                key,
                options.task,
                {
                  data: result.data,
                  provider: provider.id,
                  model: completion.model,
                } satisfies CachedEnvelope<T>,
                options.cacheTtlSeconds ?? defaultTtl,
              );
              return {
                data: result.data,
                provider: provider.id,
                model: completion.model,
                cached: false,
                attempts,
              };
            }

            const issues = schemaIssues(result.error);
            failures.push({
              provider: provider.id,
              message: `schema validation failed: ${issues.join("; ")}`,
            });
            deps.onAttempt?.({
              task: options.task,
              provider: provider.id,
              ok: false,
              message: issues.join("; "),
              ms: Date.now() - startedAt,
            });

            if (repair < maxRepairs) {
              messages.push({
                role: "assistant",
                content: completion.text.slice(0, 8000),
              });
              messages.push({ role: "user", content: repairPrompt(issues) });
              continue;
            }
            break;
          }
        } else {
          failures.push({
            provider: provider.id,
            message: "response contained no JSON object",
          });
          deps.onAttempt?.({
            task: options.task,
            provider: provider.id,
            ok: false,
            message: "response contained no JSON object",
            ms: Date.now() - startedAt,
          });
          if (repair < maxRepairs) {
            messages.push({
              role: "assistant",
              content: completion.text.slice(0, 8000),
            });
            messages.push({
              role: "user",
              content: repairPrompt(["response was not a JSON object"]),
            });
            continue;
          }
          break;
        }
      }
    }

    throw new ProviderUnavailableError(
      `All AI providers failed while generating ${options.task}.`,
      { failures, checkedAt: now().toISOString() },
    );
  };
}

export { ProviderError };
