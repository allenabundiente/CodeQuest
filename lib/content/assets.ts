import { z } from "zod";
import { MAX_SVG_CHARS, sanitizeSvg } from "./svg";

export * from "./svg";

export const SvgAssetSchema = z
  .string()
  .min(20)
  .max(MAX_SVG_CHARS)
  .refine((value) => sanitizeSvg(value).ok, {
    message:
      "Asset must be a self-contained <svg> without scripts, event handlers, or foreignObject.",
  });
