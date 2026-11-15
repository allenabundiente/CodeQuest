import { contrastRatio } from "../../lib/content/theme";
import type { HookHandler } from "../../lib/plugins/types";

const MIN_CONTRAST = 4.5;

const publishHandler: HookHandler<"content.beforePublish"> = ({ pack }) => {
  const errors: string[] = [];
  const { theme, copy, lessons } = pack;

  const bodyContrast = contrastRatio(theme.text, theme.bg);
  if (bodyContrast < MIN_CONTRAST) {
    errors.push(
      `Body text on the page background has a contrast ratio of ${bodyContrast.toFixed(2)}:1; minimum is ${MIN_CONTRAST}:1.`,
    );
  }

  const buttonContrast = contrastRatio(theme.accentInk, theme.accent);
  if (buttonContrast < MIN_CONTRAST) {
    errors.push(
      `Primary button text has a contrast ratio of ${buttonContrast.toFixed(2)}:1; minimum is ${MIN_CONTRAST}:1.`,
    );
  }

  if (!copy.brandName.trim() || !copy.tagline.trim()) {
    errors.push("Brand name and tagline must both be filled in.");
  }

  if (lessons.length === 0) {
    errors.push("Published content must feature at least one lesson.");
  }

  for (const lesson of lessons) {
    if (lesson.objectives.length === 0) {
      errors.push(`Featured lesson "${lesson.title}" has no objectives.`);
    }
  }

  return { ok: errors.length === 0, errors };
};

export const handlers = {
  "content.beforePublish": publishHandler,
};
