import assert from "node:assert/strict";
import test from "node:test";
import { createUser } from "../lib/db";
import { createResendClient, renderStreakEmail } from "../lib/email";
import type { EmailClient, EmailMessage } from "../lib/email";
import { EmailDeliveryError } from "../lib/errors";
import {
  computeStreak,
  longestStreak,
  recordActivity,
  sendStreakEmails,
  shiftDay,
  streakSummary,
} from "../lib/streaks";
import { jsonResponse, makeDb } from "./helpers";

const TODAY = "2026-11-11";

test("computes active and broken streaks", () => {
  assert.equal(computeStreak([], TODAY), 0);
  assert.equal(
    computeStreak(["2026-11-09", "2026-11-10", "2026-11-11"], TODAY),
    3,
  );
  assert.equal(
    computeStreak(["2026-11-08", "2026-11-09", "2026-11-10"], TODAY),
    3,
  );
  assert.equal(
    computeStreak(["2026-11-08", "2026-11-10", "2026-11-11"], TODAY),
    2,
  );
  assert.equal(computeStreak(["2026-10-01"], TODAY), 0);
});

test("handles month boundaries and finds the longest run", () => {
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDay("2026-01-01", -1), "2025-12-31");
  assert.equal(
    longestStreak([
      "2026-11-01",
      "2026-11-02",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]),
    3,
  );
});

test("summarizes activity for the dashboard", () => {
  const db = makeDb();
  const user = createUser(db, { email: "streak@example.com" });
  recordActivity(db, user.id, "2026-11-10");
  recordActivity(db, user.id, "2026-11-11");

  const summary = streakSummary(db, user.id, new Date("2026-11-11T12:00:00Z"));
  assert.equal(summary.current, 2);
  assert.equal(summary.longest, 2);
  assert.equal(summary.activeToday, true);
});

test("sends one streak email per active learner per day", async () => {
  const db = makeDb();
  const active = createUser(db, { email: "active@example.com", name: "Ana Cruz" });
  const singleDay = createUser(db, { email: "single@example.com" });
  recordActivity(db, active.id, "2026-11-10");
  recordActivity(db, active.id, "2026-11-11");
  recordActivity(db, singleDay.id, "2026-11-11");

  const sent: EmailMessage[] = [];
  const email: EmailClient = {
    async send(message) {
      sent.push(message);
      return { id: `email-${sent.length}` };
    },
  };

  const now = () => new Date("2026-11-11T09:00:00Z");
  const deps = { db, email, appUrl: "https://app.example.com", now, minStreak: 2 };

  const first = await sendStreakEmails(deps);
  assert.equal(first.sent, 1);
  assert.equal(first.skipped, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /2-day streak/);
  assert.match(sent[0].text, /Ana/);

  const second = await sendStreakEmails(deps);
  assert.equal(second.sent, 0);
  assert.equal(sent.length, 1);

  const log = db
    .prepare("SELECT status FROM email_log WHERE user_id = ?")
    .all(active.id) as Array<{ status: string }>;
  assert.equal(log.length, 1);
  assert.equal(log[0].status, "sent");
});

test("renders a usable streak email with a lesson link", () => {
  const rendered = renderStreakEmail({
    name: "Ana Cruz",
    streak: 5,
    appUrl: "https://app.example.com/",
    lesson: { id: "lesson-1", title: "Binary search" },
  });

  assert.match(rendered.subject, /5-day streak/);
  assert.match(rendered.html, /https:\/\/app\.example\.com\/lessons\/lesson-1/);
  assert.match(rendered.text, /Binary search/);
});

test("Resend client returns the provider id and surfaces failures", async () => {
  const captured: { body?: Record<string, unknown> } = {};
  const client = createResendClient({
    apiKey: "re_test",
    from: "CodeQuest <streaks@example.com>",
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.body = JSON.parse(String(init?.body));
      return jsonResponse({ id: "email_123" });
    }) as typeof fetch,
  });

  const result = await client.send({
    to: "learner@example.com",
    subject: "Hello",
    html: "<p>hi</p>",
    text: "hi",
  });

  assert.equal(result.id, "email_123");
  assert.deepEqual(captured.body?.to, ["learner@example.com"]);
  assert.equal(captured.body?.from, "CodeQuest <streaks@example.com>");

  const failing = createResendClient({
    apiKey: "re_test",
    from: "streaks@example.com",
    fetchImpl: (async () =>
      jsonResponse({ message: "invalid from" }, 422)) as typeof fetch,
  });

  await assert.rejects(
    failing.send({ to: "a@b.co", subject: "s", html: "h", text: "t" }),
    (error: unknown) => error instanceof EmailDeliveryError,
  );
});
