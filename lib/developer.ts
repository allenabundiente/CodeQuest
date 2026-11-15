import { authorizeDeveloper } from "./authz";
import type { DeveloperContext } from "./authz";
import { createUser, findUserByEmail, setUserRole } from "./db";
import type { Db, UserRecord } from "./db";
import { ConfigurationError } from "./errors";

/** Comma-separated allowlist. A matching email becomes a developer on login. */
export function developerEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.DEVELOPER_EMAILS ?? env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function syncDeveloperRole(
  db: Db,
  user: UserRecord,
  env: NodeJS.ProcessEnv = process.env,
): UserRecord {
  if (user.role === "developer") return user;
  if (!developerEmails(env).includes(user.email.toLowerCase())) return user;
  return setUserRole(db, user.id, "developer") ?? user;
}

export function ensureDeveloperUser(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
): UserRecord {
  const email = developerEmails(env)[0];
  if (!email) {
    throw new ConfigurationError(
      "Set DEVELOPER_EMAILS to a comma-separated allowlist before using developer tooling.",
    );
  }
  const existing = findUserByEmail(db, email);
  if (existing) return syncDeveloperRole(db, existing, env);
  return createUser(db, {
    email,
    name: "Content Admin",
    role: "developer",
  });
}

/** CLI access is gated by local filesystem access plus DEVELOPER_EMAILS. */
export function cliDeveloperContext(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
): DeveloperContext {
  return authorizeDeveloper(ensureDeveloperUser(db, env));
}
