import type {
  CompletionRequest,
  CompletionResult,
  Provider,
  ProviderId,
} from "./types";
import { ProviderError } from "./types";

export interface OpenAiCompatibleConfig {
  id: ProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** One adapter, three providers: Gemini/DeepSeek via OpenRouter, Groq direct. */
export function createOpenAiCompatibleProvider(
  config: OpenAiCompatibleConfig,
): Provider {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 45_000;
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  return {
    id: config.id,
    model: config.model,

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const body: Record<string, unknown> = {
        model: config.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.4,
        max_tokens: request.maxTokens ?? 3000,
      };
      if (request.json) {
        body.response_format = { type: "json_object" };
      }

      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = request.signal
        ? AbortSignal.any([request.signal, timeoutSignal])
        : timeoutSignal;

      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
            ...config.headers,
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "network request failed";
        throw new ProviderError(config.id, `${config.id} request failed: ${message}`, {
          retryable: true,
          cause: error,
        });
      }

      const raw = await response.text();

      if (!response.ok) {
        let detail = raw.slice(0, 300);
        try {
          const parsed = JSON.parse(raw) as ChatCompletionResponse;
          detail = parsed.error?.message ?? detail;
        } catch {
          // keep the raw text snippet
        }
        throw new ProviderError(
          config.id,
          `${config.id} returned HTTP ${response.status}: ${detail}`,
          {
            status: response.status,
            retryable: RETRYABLE_STATUS.has(response.status),
          },
        );
      }

      let payload: ChatCompletionResponse;
      try {
        payload = JSON.parse(raw) as ChatCompletionResponse;
      } catch (error) {
        throw new ProviderError(config.id, `${config.id} returned non-JSON body`, {
          retryable: true,
          cause: error,
        });
      }

      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new ProviderError(config.id, `${config.id} returned an empty completion`, {
          retryable: true,
        });
      }

      return {
        text: content,
        provider: config.id,
        model: config.model,
        usage: {
          inputTokens: payload.usage?.prompt_tokens,
          outputTokens: payload.usage?.completion_tokens,
        },
      };
    },
  };
}
