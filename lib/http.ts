import { cookies } from "next/headers";
import type { ZodType } from "zod";
import { authorizeDeveloper } from "./authz";
import type { DeveloperContext } from "./authz";
import { findUserById, getDb } from "./db";
import type { UserRecord } from "./db";
import { BadRequestError, isAppError, UnauthorizedError } from "./errors";
import { captureException } from "./sentry";
import { resolveSession } from "./session";

export const SESSION_COOKIE = "cq_session";

export async function currentUser(): Promise<UserRecord | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const sessionUser = resolveSession(db, token);
  if (!sessionUser) return null;
  return findUserById(db, sessionUser.id);
}

export async function requireUser(): Promise<UserRecord> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Route-level guard that mints the developer token used by row policies. */
export async function requireDeveloper(): Promise<DeveloperContext> {
  return authorizeDeveloper(await requireUser());
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function errorResponse(error: unknown): Response {
  if (isAppError(error)) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      },
      { status: error.status, headers: { "cache-control": "no-store" } },
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error("[codequest] unhandled error:", error);
  // Fire-and-forget: a Sentry outage must never delay or fail the response.
  void captureException(error, {
    route: "api",
    tags: { code: "internal_error" },
  });
  return Response.json(
    {
      error: {
        code: "internal_error",
        message:
          process.env.NODE_ENV === "production"
            ? "Something went wrong. Please try again."
            : message,
      },
    },
    { status: 500, headers: { "cache-control": "no-store" } },
  );
}

export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new BadRequestError("Expected a JSON request body.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestError(
      "Request validation failed.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.length ? issue.path.map(String).join(".") : "(root)",
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

export function sessionCookieOptions(expiresAt: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  };
}
