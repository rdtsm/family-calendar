export const ACCENTS = {
  violet: "oklch(0.74 0.16 300)",
  sky: "oklch(0.76 0.13 230)",
  mint: "oklch(0.80 0.14 165)",
  amber: "oklch(0.83 0.14 75)",
  rose: "oklch(0.74 0.16 15)",
  lime: "oklch(0.84 0.16 130)",
} as const;

/**
 * The same hues, dark enough to be read as text or seen as a border on a light
 * surface. The fills above measure roughly 3:1 against white — fine behind dark
 * text, far too weak to be text themselves.
 */
export const ACCENT_INKS: Record<keyof typeof ACCENTS, string> = {
  violet: "oklch(0.45 0.20 300)",
  sky: "oklch(0.44 0.15 230)",
  mint: "oklch(0.42 0.12 165)",
  amber: "oklch(0.44 0.12 75)",
  rose: "oklch(0.46 0.19 15)",
  lime: "oklch(0.42 0.13 130)",
};

export type AccentName = keyof typeof ACCENTS;

export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];

/**
 * The parent app's own colour. Fixed on purpose: a child changing their accent
 * marks who an event belongs to, and must not restyle the screen their mother
 * is working in.
 */
export const PARENT_ACCENT = ACCENTS.violet;
export const PARENT_ACCENT_INK = ACCENT_INKS.violet;

export function accent(name: string): string {
  return ACCENTS[name as AccentName] ?? ACCENTS.violet;
}

/** Use wherever the colour becomes text or a border rather than a fill. */
export function accentInk(name: string): string {
  return ACCENT_INKS[name as AccentName] ?? ACCENT_INKS.violet;
}

/**
 * What a child can choose as their avatar. A fixed grid rather than a text
 * input: it needs no keyboard, works with one tap, and cannot produce the
 * half-formed characters an IME does when an emoji is typed into a controlled
 * input. All are single, widely supported glyphs that stay legible at 24px.
 */
export const AVATARS = [
  "🦊", "🐼", "🦁", "🐯", "🐨", "🐰",
  "🐶", "🐱", "🐧", "🦉", "🦋", "🐝",
  "🐢", "🐙", "🐬", "🐳", "🦈", "🐍",
  "🦄", "🦖", "🦕", "🐵", "🐸", "🦩",
] as const;
