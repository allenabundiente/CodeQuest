import { AppError, BadRequestError, NotFoundError } from "../errors";
import type { Language } from "../types";

const EXTENSION_LANGUAGES: Record<string, Language> = {
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  go: "go",
  java: "java",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  h: "cpp",
  c: "cpp",
};

const EXCLUDED_PATH = [
  /(^|\/)node_modules\//,
  /(^|\/)(dist|build|out|coverage|vendor|\.next)\//,
  /(^|\/)\.(git|github)\//,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/,
  /(^|\/)(test|tests|__tests__|spec)\//,
  /\.(min|map)\.(js|css)$/,
  /(^|\/)(LICENSE|CHANGELOG|CODE_OF_CONDUCT)/i,
];

export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
}

export interface RepoFile {
  path: string;
  content: string;
  language: Language | null;
}

export interface RepoContext {
  owner: string;
  repo: string;
  ref: string;
  description: string | null;
  files: RepoFile[];
  text: string;
  truncated: boolean;
}

const GITHUB_API = "https://api.github.com";

export function parseGitHubUrl(input: string): RepoRef {
  const raw = input.trim();
  if (!raw) throw new BadRequestError("Paste a GitHub repository URL.");

  let url: URL;
  const shorthand = raw.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) {
    url = new URL(`https://github.com/${shorthand[1]}/${shorthand[2]}`);
  } else {
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      throw new BadRequestError("That does not look like a GitHub URL.");
    }
  }

  if (!/(^|\.)github\.com$/i.test(url.hostname)) {
    throw new BadRequestError("Only public github.com repositories can be imported.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new BadRequestError(
      "Use a repository URL such as https://github.com/owner/repo.",
    );
  }

  const [owner, repoPart, marker, ...rest] = parts;
  const repo = repoPart.replace(/\.git$/i, "");
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    throw new BadRequestError("That repository URL is not valid.");
  }

  let ref: string | undefined;
  let path: string | undefined;
  if ((marker === "tree" || marker === "blob") && rest.length > 0) {
    ref = decodeURIComponent(rest[0]);
    path = rest.slice(1).join("/") || undefined;
  }

  return {
    owner,
    repo,
    ...(ref ? { ref } : {}),
    ...(path ? { path } : {}),
  };
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "CodeQuest",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function githubJson<T>(
  url: string,
  doFetch: typeof fetch,
  token?: string,
): Promise<T> {
  const response = await doFetch(url, { headers: authHeaders(token) });
  if (response.status === 404) {
    throw new NotFoundError("Repository, branch, or path not found.");
  }
  if (response.status === 403 || response.status === 429) {
    throw new AppError(
      "github_rate_limited",
      "GitHub rate limit hit while importing this repository. Set GITHUB_TOKEN or retry later.",
      429,
    );
  }
  if (!response.ok) {
    throw new AppError(
      "github_error",
      `GitHub returned HTTP ${response.status}.`,
      502,
    );
  }
  return (await response.json()) as T;
}

interface RepoMeta {
  default_branch: string;
  description: string | null;
  private?: boolean;
}

interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

interface TreeResponse {
  tree: TreeEntry[];
  truncated?: boolean;
}

export interface FetchRepoOptions {
  url: string;
  token?: string;
  fetchImpl?: typeof fetch;
  maxFiles?: number;
  maxFileChars?: number;
  maxTotalChars?: number;
}

/**
 * Fetch a compact, readable slice of a public repository: a bounded set of
 * source files that fit comfortably in a model prompt.
 */
export async function fetchRepoContext(
  options: FetchRepoOptions,
): Promise<RepoContext> {
  const doFetch = options.fetchImpl ?? fetch;
  const parsed = parseGitHubUrl(options.url);
  const maxFiles = options.maxFiles ?? 12;
  const maxFileChars = options.maxFileChars ?? 12_000;
  const maxTotalChars = options.maxTotalChars ?? 48_000;

  const meta = await githubJson<RepoMeta>(
    `${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}`,
    doFetch,
    options.token,
  );

  const ref = parsed.ref ?? meta.default_branch;
  const tree = await githubJson<TreeResponse>(
    `${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    doFetch,
    options.token,
  );

  const prefix = parsed.path?.replace(/\/$/, "");
  const candidates = tree.tree
    .filter((entry) => entry.type === "blob")
    .filter((entry) => (prefix ? entry.path.startsWith(`${prefix}/`) : true))
    .filter((entry) => !EXCLUDED_PATH.some((pattern) => pattern.test(entry.path)))
    .filter((entry) => {
      const ext = entry.path.split(".").pop()?.toLowerCase() ?? "";
      return ext in EXTENSION_LANGUAGES;
    })
    .filter((entry) => (entry.size ?? 0) > 0 && (entry.size ?? 0) <= 40_000)
    .sort((a, b) => {
      const depth = a.path.split("/").length - b.path.split("/").length;
      return depth !== 0 ? depth : a.path.localeCompare(b.path);
    })
    .slice(0, maxFiles);

  if (candidates.length === 0) {
    throw new BadRequestError(
      "No readable source files were found in that repository path.",
    );
  }

  const files: RepoFile[] = [];
  let totalChars = 0;
  let truncated = Boolean(tree.truncated);

  for (const entry of candidates) {
    if (totalChars >= maxTotalChars) {
      truncated = true;
      break;
    }
    const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${encodeURIComponent(ref)}/${entry.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    try {
      const response = await doFetch(rawUrl, {
        headers: options.token
          ? { authorization: `Bearer ${options.token}` }
          : undefined,
      });
      if (!response.ok) continue;
      const text = (await response.text()).slice(0, maxFileChars);
      if (!text.trim()) continue;
      const ext = entry.path.split(".").pop()?.toLowerCase() ?? "";
      files.push({
        path: entry.path,
        content: text,
        language: EXTENSION_LANGUAGES[ext] ?? null,
      });
      totalChars += text.length;
    } catch {
      // A single unreadable file should not sink the import.
      continue;
    }
  }

  if (files.length === 0) {
    throw new BadRequestError(
      "Could not download any files from that repository. It may be too large or empty.",
    );
  }

  const text = files
    .map(
      (file) =>
        `### ${file.path}\n\`\`\`${file.language ?? ""}\n${file.content.trim()}\n\`\`\``,
    )
    .join("\n\n");

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    ref,
    description: meta.description,
    files,
    text,
    truncated,
  };
}
