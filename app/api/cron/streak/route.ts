import { getDb } from "@/lib/db";
import { emailClientFromEnv } from "@/lib/email";
import { isFeatureEnabled } from "@/lib/flags";
import { errorResponse, json } from "@/lib/http";
import { safeEqual } from "@/lib/session";
import { sendStreakEmails } from "@/lib/streaks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(request: Request): Response | null {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) {
    return json(
      {
        error: {
          code: "configuration_error",
          message: "CRON_SECRET is not configured.",
        },
      },
      503,
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.replace(/^Bearer\s+/i, "").trim();
  const querySecret = new URL(request.url).searchParams.get("secret") ?? "";
  const supplied = bearer || querySecret;

  if (!supplied || !safeEqual(supplied, secret)) {
    return json(
      {
        error: {
          code: "unauthorized",
          message: "Provide the cron secret as a Bearer token.",
        },
      },
      401,
    );
  }
  return null;
}

async function run(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  if (!isFeatureEnabled("streakEmails")) {
    return json(
      {
        error: {
          code: "feature_disabled",
          message: "Streak emails are disabled on this deployment.",
        },
      },
      503,
    );
  }

  const email = emailClientFromEnv();
  if (!email) {
    return json(
      {
        error: {
          code: "configuration_error",
          message:
            "Resend is not configured. Set RESEND_API_KEY and RESEND_FROM.",
        },
      },
      503,
    );
  }

  const db = getDb();
  const result = await sendStreakEmails({
    db,
    email,
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
    minStreak: Number(process.env.STREAK_EMAIL_MIN ?? 2),
    pickLesson: (userId) => {
      const row = db
        .prepare(
          "SELECT id, title FROM lessons WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(userId) as { id: string; title: string } | undefined;
      return row ?? null;
    },
  });

  return json({ ok: true, ...result });
}

export async function GET(request: Request) {
  try {
    return await run(request);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return await run(request);
  } catch (error) {
    return errorResponse(error);
  }
}
