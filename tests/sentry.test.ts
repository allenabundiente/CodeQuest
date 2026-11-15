import test from "node:test";
import assert from "node:assert/strict";
import {
  captureException,
  createSentryEvent,
  parseSentryDsn,
  resolveSentryDsn,
} from "../lib/sentry";

const DSN = "https://publickey@o123.ingest.sentry.io/456";

test("parseSentryDsn builds the Store API endpoint", () => {
  assert.deepEqual(parseSentryDsn(DSN), {
    endpoint: "https://o123.ingest.sentry.io/api/456/store/",
    publicKey: "publickey",
  });
  assert.equal(parseSentryDsn(""), null);
  assert.equal(parseSentryDsn("not-a-url"), null);
  assert.equal(parseSentryDsn("https://o123.ingest.sentry.io/456"), null);
});

test("resolveSentryDsn prefers the public DSN", () => {
  const env = {
    NEXT_PUBLIC_SENTRY_DSN: DSN,
    SENTRY_DSN: "https://server@example.com/1",
  } as unknown as NodeJS.ProcessEnv;
  assert.equal(resolveSentryDsn(env), DSN);
  assert.equal(resolveSentryDsn({} as NodeJS.ProcessEnv), "");
});

test("createSentryEvent captures message, tags, and stack", () => {
  const error = new Error("boom");
  const event = createSentryEvent(
    error,
    { route: "/api/lessons", method: "POST", tags: { code: "internal_error" } },
    { release: "0.4.0", environment: "test" },
  );
  assert.equal(event.transaction, "/api/lessons");
  assert.equal(event.release, "0.4.0");
  const tags = event.tags as Record<string, string>;
  assert.equal(tags.method, "POST");
  assert.equal(tags.code, "internal_error");
  const extra = event.extra as Record<string, unknown>;
  assert.match(String(extra.stack), /boom/);
  const exception = event.exception as {
    values: Array<{ type: string; value: string }>;
  };
  assert.equal(exception.values[0].type, "Error");
  assert.equal(exception.values[0].value, "boom");
});

test("captureException posts an authenticated envelope", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const ok = await captureException(
    new Error("kaboom"),
    { route: "/api/x", method: "GET" },
    {
      env: {
        NEXT_PUBLIC_SENTRY_DSN: DSN,
        NODE_ENV: "test",
      } as NodeJS.ProcessEnv,
      fetchImpl,
    },
  );

  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://o123.ingest.sentry.io/api/456/store/");
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.match(headers["x-sentry-auth"], /sentry_key=publickey/);
  const body = JSON.parse(String(calls[0].init.body)) as {
    exception: { values: Array<{ value: string }> };
    environment: string;
  };
  assert.equal(body.exception.values[0].value, "kaboom");
  assert.equal(body.environment, "test");
});

test("captureException is a no-op without a DSN and never throws", async () => {
  const noDsn = await captureException(new Error("x"), {}, {
    env: {} as NodeJS.ProcessEnv,
    fetchImpl: (async () => {
      throw new Error("must not be called");
    }) as typeof fetch,
  });
  assert.equal(noDsn, false);

  const failed = await captureException(new Error("x"), {}, {
    env: { SENTRY_DSN: DSN } as unknown as NodeJS.ProcessEnv,
    fetchImpl: (async () => {
      throw new Error("sentry is down");
    }) as typeof fetch,
  });
  assert.equal(failed, false);
});
