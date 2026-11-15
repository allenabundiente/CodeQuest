import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { createAiCache } from "../lib/cache";
import {
  createGenerateJson,
} from "../lib/providers/generate";
import type { Provider, ProviderId } from "../lib/providers/types";
import { ProviderError } from "../lib/providers/types";
import { createQuotaService } from "../lib/quota";
import { ProviderUnavailableError, QuotaExceededError } from "../lib/errors";
import { makeDb, seedUser } from "./helpers";

const answerSchema = z.object({ answer: z.number().int() });

function provider(
  id: ProviderId,
  complete: Provider["complete"],
): Provider {
  return { id, model: `${id}-test-model`, complete };
}

function completion(id: ProviderId, payload: unknown) {
  return {
    text: JSON.stringify(payload),
    provider: id,
    model: `${id}-test-model`,
    usage: { inputTokens: 12, outputTokens: 6 },
  };
}

test("falls back to the next provider when the first fails", async () => {
  const calls: ProviderId[] = [];
  const generate = createGenerateJson({
    providers: [
      provider("gemini", async () => {
        calls.push("gemini");
        throw new ProviderError("gemini", "rate limited", { status: 429 });
      }),
      provider("deepseek", async () => {
        calls.push("deepseek");
        return completion("deepseek", { answer: 42 });
      }),
    ],
  });

  const result = await generate({
    task: "unit:fallback",
    system: "system",
    prompt: "prompt",
    schema: answerSchema,
  });

  assert.equal(result.data.answer, 42);
  assert.equal(result.provider, "deepseek");
  assert.equal(result.attempts, 2);
  assert.deepEqual(calls, ["gemini", "deepseek"]);
});

test("repairs invalid JSON with a second model call on the same provider", async () => {
  let calls = 0;
  const generate = createGenerateJson({
    providers: [
      provider("groq", async () => {
        calls += 1;
        return calls === 1
          ? completion("groq", { answer: "not a number" })
          : completion("groq", { answer: 7 });
      }),
    ],
  });

  const result = await generate({
    task: "unit:repair",
    system: "system",
    prompt: "prompt",
    schema: answerSchema,
    repairAttempts: 1,
  });

  assert.equal(calls, 2);
  assert.equal(result.data.answer, 7);
});

test("serves repeated identical prompts from the cache", async () => {
  const db = makeDb();
  let calls = 0;
  const generate = createGenerateJson({
    cache: createAiCache(db),
    providers: [
      provider("gemini", async () => {
        calls += 1;
        return completion("gemini", { answer: 1 });
      }),
    ],
  });

  const options = {
    task: "unit:cache",
    system: "system",
    prompt: "same prompt",
    schema: answerSchema,
  } as const;

  const first = await generate(options);
  const second = await generate(options);

  assert.equal(calls, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.data.answer, 1);
});

test("enforces the per-user daily quota and records usage", async () => {
  const db = makeDb();
  const user = seedUser(db);
  const quota = createQuotaService(db, { dailyCalls: 1, dailyTokens: 10_000 });
  const generate = createGenerateJson({
    quota,
    providers: [
      provider("gemini", async () => completion("gemini", { answer: 5 })),
    ],
  });

  await generate({
    task: "unit:quota",
    system: "s",
    prompt: "first",
    schema: answerSchema,
    userId: user.id,
  });

  const snapshot = quota.snapshot(user.id);
  assert.equal(snapshot.usedCalls, 1);
  assert.equal(snapshot.remainingCalls, 0);
  assert.equal(snapshot.usedTokens, 18);

  await assert.rejects(
    generate({
      task: "unit:quota",
      system: "s",
      prompt: "second",
      schema: answerSchema,
      userId: user.id,
    }),
    (error: unknown) => error instanceof QuotaExceededError,
  );
});

test("reports every failure when all providers fail", async () => {
  const generate = createGenerateJson({
    providers: [
      provider("gemini", async () => {
        throw new ProviderError("gemini", "boom");
      }),
      provider("groq", async () => {
        throw new ProviderError("groq", "also boom");
      }),
    ],
  });

  await assert.rejects(
    generate({
      task: "unit:all-fail",
      system: "s",
      prompt: "p",
      schema: answerSchema,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderUnavailableError);
      const details = error.details as { failures: unknown[] };
      assert.equal(details.failures.length, 2);
      return true;
    },
  );
});
