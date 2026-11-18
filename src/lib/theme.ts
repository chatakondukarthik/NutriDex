/**
 * Appearance settings.
 *
 * Kept as three small cookies rather than one JSON blob so a server
 * component can read a single value without parsing, and so a future
 * page can read only what it needs. The values are also mirrored into
 * `localStorage` by the provider: the cookie avoids a flash on the next
 * server render, the local copy lets the client apply a change instantly.
 */

export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const ACCENTS = ["forest", "ocean", "plum", "ember"] as const;
export type Accent = (typeof ACCENTS)[number];

export interface ThemeSettings {
  mode: ThemeMode;
  accent: Accent;
  motion: boolean;
  sound: boolean;
  /** The corner plate folds into the next room's plate on tab change. */
  transition: boolean;
}

export const DEFAULT_THEME: ThemeSettings = {
  mode: "system",
  accent: "forest",
  motion: true,
  sound: true,
  transition: true,
};

export const THEME_COOKIE = "np_theme";
export const ACCENT_COOKIE = "np_accent";
export const MOTION_COOKIE = "np_motion";
export const SOUND_COOKIE = "np_sound";
export const TRANSITION_COOKIE = "np_transition";

export const MODE_LABELS: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export const MODE_DESCRIPTIONS: Record<ThemeMode, string> = {
  system: "Follow the device setting.",
  light: "Always use the light palette.",
  dark: "Always use the dark palette.",
};

export const ACCENT_LABELS: Record<Accent, string> = {
  forest: "Forest",
  ocean: "Ocean",
  plum: "Plum",
  ember: "Ember",
};

/** Used for the swatch previews; the real token lives in globals.css. */
export const ACCENT_PREVIEW: Record<Accent, string> = {
  forest: "oklch(0.46 0.115 152)",
  ocean: "oklch(0.46 0.11 205)",
  plum: "oklch(0.47 0.13 330)",
  ember: "oklch(0.52 0.16 33)",
};

export function parseThemeSettings(input: {
  mode?: string | null;
  accent?: string | null;
  motion?: string | null;
  sound?: string | null;
  transition?: string | null;
}): ThemeSettings {
  return {
    mode: isMode(input.mode) ? input.mode : DEFAULT_THEME.mode,
    accent: isAccent(input.accent) ? input.accent : DEFAULT_THEME.accent,
    motion: input.motion == null ? DEFAULT_THEME.motion : input.motion !== "off",
    sound: input.sound == null ? DEFAULT_THEME.sound : input.sound !== "off",
    transition: input.transition == null ? DEFAULT_THEME.transition : input.transition !== "off",
  };
}

export function isMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).includes(value);
}

export function isAccent(value: unknown): value is Accent {
  return typeof value === "string" && (ACCENTS as readonly string[]).includes(value);
}
