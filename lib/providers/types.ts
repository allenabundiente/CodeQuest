export type ProviderId = "gemini" | "deepseek" | "groq";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask the API for a JSON object response when the provider supports it. */
  json?: boolean;
  signal?: AbortSignal;
}

export interface CompletionUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface CompletionResult {
  text: string;
  provider: ProviderId;
  model: string;
  usage: CompletionUsage;
}

export interface Provider {
  id: ProviderId;
  model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    provider: ProviderId,
    message: string,
    options: { status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.provider = provider;
    this.status = options.status;
    this.retryable = options.retryable ?? true;
  }
}
