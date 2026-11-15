import bundledRaw from "../../content/bundled/pack.json";
import type { ContentPack } from "./schema";
import { validatePack } from "./schema";

function loadBundled(): ContentPack {
  const result = validatePack(bundledRaw);
  if (!result.ok || !result.pack) {
    throw new Error(
      `Bundled content pack is invalid: ${result.errors.join("; ")}`,
    );
  }
  return result.pack;
}

/**
 * The bundled pack is the last line of defense: if no remote pack is
 * published, or the published one fails validation, the app serves this.
 */
export const BUNDLED_PACK: ContentPack = loadBundled();
