import { cookies } from "next/headers";
import { LoginSchema } from "@/lib/api-schemas";
import { getDb, upsertUserByEmail } from "@/lib/db";
import { syncDeveloperRole } from "@/lib/developer";
import {
  errorResponse,
  json,
  parseJson,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/http";
import { issueSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await parseJson(request, LoginSchema);
    const db = getDb();
    const user = syncDeveloperRole(
      db,
      upsertUserByEmail(db, body.email, body.name ?? null),
    );
    const session = issueSession(db, user.id);

    const jar = await cookies();
    jar.set(
      SESSION_COOKIE,
      session.token,
      sessionCookieOptions(session.expiresAt),
    );

    return json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
