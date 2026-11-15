export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

function channelLuminance(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

/** WCAG 2.x contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ThemeLike {
  bg: string;
  panel: string;
  text: string;
  muted: string;
  accent: string;
  accentInk: string;
  blue: string;
  border: string;
  danger: string;
  warn: string;
  radius: string;
}

/** Map pack theme tokens onto the CSS custom properties used by the app. */
export function themeStyle(theme: ThemeLike): Record<string, string> {
  return {
    "--bg": theme.bg,
    "--panel": theme.panel,
    "--text": theme.text,
    "--muted": theme.muted,
    "--accent": theme.accent,
    "--accent-ink": theme.accentInk,
    "--blue": theme.blue,
    "--border": theme.border,
    "--danger": theme.danger,
    "--warn": theme.warn,
    "--radius": theme.radius,
  };
}
