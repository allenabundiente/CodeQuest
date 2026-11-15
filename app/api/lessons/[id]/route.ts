import { getDb } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { errorResponse, json, requireUser } from "@/lib/http";
import { listHints } from "@/lib/hints";
import { loadLesson, toLessonView } from "@/lib/lessons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const db = getDb();
    const lesson = loadLesson(db, user.id, id);
    if (!lesson) throw new NotFoundError("Lesson not found.");

    return json({
      lesson: toLessonView(lesson),
      hints: listHints(db, id),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
