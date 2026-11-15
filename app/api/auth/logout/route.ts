import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { errorResponse, json, SESSION_COOKIE } from "@/lib/http";
import { revokeSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (token) revokeSession(getDb(), token);
    jar.delete(SESSION_COOKIE);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
