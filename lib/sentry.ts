/**
 * Minimal Sentry Store-API client. We avoid the SDK so the same code runs in
 * the browser, Node route handlers, and error boundaries without bundling
 * platform-specific transports. If no DSN is set, capture is a no-op.
 */

export interface SentryDsn {
  endpoint: string;
  publicKey: string;
}

export interface SentryContext {
  route?: string;
  method?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export interface SentryOptions {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  release?: string;
  environment?: string;
  timeoutMs?: number;
}

export function parseSentryDsn(dsn: string): SentryDsn | null {
  const value = dsn.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\//, "");
    if (!publicKey || !projectId) return null;
    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/store/`,
      publicKey,
    };
  } catch {
    return null;
  }
}

function newEventId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(
      0,
      32,
    );
  }
}

function errorType(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return typeof error;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Non-error exception thrown";
}

export function createSentryEvent(
  error: unknown,
  context: SentryContext = {},
  options: { release?: string; environment?: string } = {},
): Record<string, unknown> {
  const stack = error instanceof Error ? error.stack : undefined;
  return {
    event_id: newEventId(),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    release: options.release,
    environment: options.environment,
    transaction: context.route,
    tags: {
      ...(context.tags ?? {}),
      ...(context.method ? { method: context.method } : {}),
    },
    extra: {
      ...(context.extra ?? {}),
      ...(stack ? { stack } : {}),
    },
    exception: {
      values: [
        {
          type: errorType(error),
          value: errorMessage(error),
        },
      ],
    },
  };
}

export function resolveSentryDsn(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.NEXT_PUBLIC_SENTRY_DSN?.trim() || env.SENTRY_DSN?.trim() || ""
  );
}

/**
 * Fire-and-forget capture. Never throws and never blocks the response path;
 * a Sentry outage must not become an application outage.
 */
export async function captureException(
  error: unknown,
  context: SentryContext = {},
  options: SentryOptions = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  const dsn = parseSentryDsn(resolveSentryDsn(env));
  if (!dsn) return false;

  const event = createSentryEvent(error, context, {
    release: options.release ?? env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
    environment: options.environment ?? env.NODE_ENV ?? "development",
  });

  try {
    const response = await (options.fetchImpl ?? fetch)(dsn.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=codequest/1.0`,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(options.timeoutMs ?? 2500),
    });
    return response.ok;
  } catch {
    return false;
  }
}
