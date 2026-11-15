/**
 * Next.js instrumentation hook. Unexpected route-handler errors are forwarded
 * to Sentry when a DSN is configured; without one this is a no-op.
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
