/**
 * Next.js runs this once per server process, before request handling. The
 * Supabase snapshot must land on disk before `getDb()` opens SQLite.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { startPersistence } = await import("./lib/persistence");
  await startPersistence();
}

/**
 * Unexpected route-handler errors are forwarded to Sentry when a DSN is
 * configured; without one this is a no-op.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: {
    routerKind: string;
    routePath: string;
    routeType: string;
  },
): Promise<void> {
  const { captureException } = await import("./lib/sentry");
  await captureException(error, {
    route: context.routePath || request.path,
    method: request.method,
    tags: {
      router: context.routerKind,
      routeType: context.routeType,
    },
  });
}
