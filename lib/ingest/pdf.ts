import { extractText, getDocumentProxy } from "unpdf";
import { BadRequestError } from "../errors";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_CHARS = 60_000;

export interface ExtractedPdf {
  text: string;
  pages: number;
  truncated: boolean;
}

export function isPdfUpload(fileName: string, mimeType: string): boolean {
  return (
    mimeType === "application/pdf" ||
    fileName.toLowerCase().endsWith(".pdf")
  );
}

/**
 * Extract selectable text from a PDF and enforce a size/quality floor so a
 * scanned handout fails loudly instead of generating a nonsense lesson.
 */
export async function extractPdfText(
  data: Uint8Array,
  options: { maxChars?: number } = {},
): Promise<ExtractedPdf> {
  if (data.byteLength === 0) {
    throw new BadRequestError("The uploaded PDF is empty.");
  }
  if (data.byteLength > MAX_PDF_BYTES) {
    throw new BadRequestError("PDFs must be 10 MB or smaller.");
  }

  let pages = 0;
  let raw = "";
  try {
    const pdf = await getDocumentProxy(data);
    const extracted = await extractText(pdf, { mergePages: true });
    pages = extracted.totalPages;
    raw = Array.isArray(extracted.text)
      ? extracted.text.join("\n\n")
      : extracted.text;
  } catch (error) {
    throw new BadRequestError(
      "Could not read this PDF. Upload a text-based PDF rather than a scan.",
      { cause: error instanceof Error ? error.message : undefined },
    );
  }

  const text = raw
    .replace(/\u0000/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.replace(/\s/g, "").length < 80) {
    throw new BadRequestError(
      "This PDF has too little selectable text to build a lesson from. Try pasting the key pages instead.",
    );
  }

  const maxChars = options.maxChars ?? MAX_PDF_CHARS;
  const truncated = text.length > maxChars;
  return {
    text: truncated ? text.slice(0, maxChars) : text,
    pages,
    truncated,
  };
}
