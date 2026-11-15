import { ImportRepoSchema } from "@/lib/api-schemas";
import { AppError } from "@/lib/errors";
import { isFeatureEnabled } from "@/lib/flags";
import { errorResponse, json, parseJson, requireUser } from "@/lib/http";
import { fetchRepoContext } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await requireUser();
    if (!isFeatureEnabled("githubImport")) {
      throw new AppError(
        "feature_disabled",
        "GitHub import is disabled on this deployment.",
        503,
      );
    }
    const body = await parseJson(request, ImportRepoSchema);
    const repo = await fetchRepoContext({
      url: body.url,
      token: process.env.GITHUB_TOKEN || undefined,
    });

    return json({
      repo: {
        owner: repo.owner,
        repo: repo.repo,
        ref: repo.ref,
        description: repo.description,
        truncated: repo.truncated,
        files: repo.files.map((file) => ({
          path: file.path,
          language: file.language,
        })),
        characters: repo.text.length,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
