import { notFound, redirect } from "next/navigation";
import { LessonWorkspace } from "@/components/LessonWorkspace";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/http";
import { listHints } from "@/lib/hints";
import { loadLesson, toLessonView } from "@/lib/lessons";

export const dynamic = "force-dynamic";

export default async function LessonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/login");

  const db = getDb();
  const lesson = loadLesson(db, user.id, id);
  if (!lesson) notFound();

  return (
    <LessonWorkspace
      lesson={toLessonView(lesson)}
      initialHints={listHints(db, id)}
    />
  );
}
