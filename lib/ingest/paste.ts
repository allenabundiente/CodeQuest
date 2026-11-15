import type { Language } from "../types";
import { BadRequestError } from "../errors";

const LANGUAGE_SIGNALS: Array<{ language: Language; patterns: RegExp[] }> = [
  {
    language: "python",
    patterns: [
      /^\s*def\s+\w+\s*\(/m,
      /^\s*from\s+[\w.]+\s+import\s+/m,
      /^\s*import\s+[\w.]+/m,
      /^\s*(if|elif|else|for|while|try|except)\b.*:\s*$/m,
      /print\(/,
      /^\s*#.*$/m,
    ],
  },
  {
    language: "typescript",
    patterns: [
      /\binterface\s+\w+\s*\{/,
      /\btype\s+\w+\s*=/,
      /:\s*(string|number|boolean|void|Promise<)/,
      /\bas\s+\w+(\[\])?/,
      /\bexport\s+(type|interface)\b/,
    ],
  },
  {
    language: "javascript",
    patterns: [
      /\b(const|let|var)\s+\w+\s*=/,
      /=>/,
      /\bconsole\.log\(/,
      /\bfunction\s+\w*\s*\(/,
      /\brequire\(['"]/,
    ],
  },
  {
    language: "go",
    patterns: [
      /^\s*package\s+\w+/m,
      /\bfunc\s+\w+\s*\(/,
      /\bfmt\.(Print|Scan)/,
      /:=\s*/,
    ],
  },
  {
    language: "java",
    patterns: [
      /\bpublic\s+(final\s+)?class\s+\w+/,
      /\bSystem\.out\.print/,
      /\bpublic\s+static\s+void\s+main\b/,
      /\bimport\s+java\./,
    ],
  },
  {
    language: "cpp",
    patterns: [
      /#include\s*[<"]/,
      /\bstd::/,
      /\busing\s+namespace\s+std\b/,
      /\bint\s+main\s*\(/,
    ],
  },
];

/** Best-effort language sniffing for pasted code. Never throws. */
export function detectLanguage(text: string): Language | null {
  if (!text.trim()) return null;
  let best: { language: Language; score: number } | null = null;
  for (const { language, patterns } of LANGUAGE_SIGNALS) {
    const score = patterns.reduce(
      (total, pattern) => total + (pattern.test(text) ? 1 : 0),
      0,
    );
    if (score > 0 && (!best || score > best.score)) {
      best = { language, score };
    }
  }
  return best?.language ?? null;
}

/** Strip a single wrapping markdown fence so pasted snippets stay clean. */
export function stripCodeFence(text: string): string {
  const match = text.trim().match(/^```[\w+#-]*\s*\n([\s\S]*?)\n?```$/);
  return match ? match[1] : text;
}

export interface PasteContextInput {
  code?: string;
  errorText?: string;
  goal?: string;
  language?: Language;
  title?: string;
}

export interface PasteContext {
  title: string;
  material: string;
  language: Language | null;
}

export function looksLikeErrorLog(text: string): boolean {
  return /\b(error|exception|traceback|stack trace|cannot|undefined is not|SyntaxError|TypeError|ReferenceError|panic:)\b/i.test(
    text,
  );
}

/**
 * Normalize "pasted code + pasted error" into a single source transcript that
 * the lesson prompt can reason about (and that the learner can recognize).
 */
export function buildPasteContext(input: PasteContextInput): PasteContext {
  const code = input.code?.trim() ? stripCodeFence(input.code) : "";
  const errorText = input.errorText?.trim() ?? "";
  const goal = input.goal?.trim() ?? "";

  if (!code && !errorText && !goal) {
    throw new BadRequestError(
      "Paste some code, an error message, or describe what you want to learn.",
    );
  }

  const language = input.language ?? detectLanguage(code || errorText);
  const sections: string[] = [];

  if (code) {
    sections.push(
      `Learner's code${language ? ` (${language})` : ""}:\n\`\`\`${language ?? ""}\n${code}\n\`\`\``,
    );
  }
  if (errorText) {
    sections.push(`Error output the learner saw:\n\`\`\`\n${errorText}\n\`\`\``);
  }
  if (goal) {
    sections.push(`What the learner wants to achieve:\n${goal}`);
  }

  const titleSource = goal || errorText || code;
  const title = input.title?.trim() || titleSource.split("\n")[0].slice(0, 90);

  return {
    title: title || "Custom lesson",
    material: sections.join("\n\n"),
    language,
  };
}
