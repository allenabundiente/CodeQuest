export const MAX_SVG_CHARS = 20_000;

export interface SvgCheck {
  ok: boolean;
  error?: string;
}

/**
 * Developer-authored SVG is rendered through an <img> data URI, which cannot
 * execute scripts, but we still reject active content so a bad asset can never
 * become a script injection vector.
 */
export function sanitizeSvg(svg: string): SvgCheck {
  const value = svg.trim();
  if (!value.toLowerCase().startsWith("<svg")) {
    return { ok: false, error: "Asset must start with <svg>." };
  }
  if (value.length > MAX_SVG_CHARS) {
    return { ok: false, error: `Asset is larger than ${MAX_SVG_CHARS} characters.` };
  }
  if (/<script[\s>]/i.test(value)) {
    return { ok: false, error: "Script tags are not allowed in assets." };
  }
  if (/<foreignObject[\s>]/i.test(value)) {
    return { ok: false, error: "foreignObject is not allowed in assets." };
  }
  if (/\son[a-z]+\s*=/i.test(value)) {
    return { ok: false, error: "Inline event handlers are not allowed in assets." };
  }
  if (/javascript:/i.test(value)) {
    return { ok: false, error: "javascript: URLs are not allowed in assets." };
  }
  return { ok: true };
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}
