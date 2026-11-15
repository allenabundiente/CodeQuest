import type { UserRecord } from "./db";
import { ForbiddenError, UnauthorizedError } from "./errors";

export interface DeveloperContext {
  readonly role: "developer";
  readonly userId: string;
  readonly email: string;
  readonly __brand: "DeveloperContext";
}

export function isDeveloper(user: UserRecord | null | undefined): boolean {
  return user?.role === "developer";
}

/**
 * The only way to obtain a DeveloperContext. Admin repository functions take
 * this token and re-assert it, so a learner-scoped request can never reach the
 * content, audit, or plugin tables.
 */
export function authorizeDeveloper(user: UserRecord | null): DeveloperContext {
  if (!user) throw new UnauthorizedError();
  if (user.role !== "developer") {
    throw new ForbiddenError("Developer role required for this action.");
  }
  return Object.freeze({
    role: "developer" as const,
    userId: user.id,
    email: user.email,
    __brand: "DeveloperContext" as const,
  });
}

export function assertDeveloperContext(
  context: DeveloperContext | null | undefined,
): asserts context is DeveloperContext {
  if (
    !context ||
    context.role !== "developer" ||
    context.__brand !== "DeveloperContext"
  ) {
    throw new ForbiddenError("Developer role required for this action.");
  }
}
