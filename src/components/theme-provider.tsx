"use client";

import { MotionConfig, useReducedMotion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ACCENT_COOKIE,
  DEFAULT_THEME,
  MOTION_COOKIE,
  SOUND_COOKIE,
  THEME_COOKIE,
  TRANSITION_COOKIE,
  type Accent,
  type ThemeMode,
  type ThemeSettings,
} from "@/lib/theme";

interface ThemeContextValue {
  settings: ThemeSettings;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: Accent) => void;
  setMotion: (motion: boolean) => void;
  setSound: (sound: boolean) => void;
  setTransition: (transition: boolean) => void;
  reset: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

function applyToDocument(settings: ThemeSettings): void {
  const root = document.documentElement;
  root.dataset.theme = settings.mode;
  root.dataset.accent = settings.accent;
  root.dataset.motion = settings.motion ? "on" : "off";
  root.dataset.sound = settings.sound ? "on" : "off";
}

/**
 * Applies appearance settings to the document and remembers them.
 *
 * The server already rendered the right attributes from cookies, so the
 * first paint is correct. This provider is what makes a change in Settings
 * immediate and what keeps the cookie in step for the next request.
 */
export function ThemeProvider({
  initial,
  children,
}: {
  initial: ThemeSettings;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState<ThemeSettings>(initial);

  useEffect(() => {
    applyToDocument(settings);
    writeCookie(THEME_COOKIE, settings.mode);
    writeCookie(ACCENT_COOKIE, settings.accent);
    writeCookie(MOTION_COOKIE, settings.motion ? "on" : "off");
    writeCookie(SOUND_COOKIE, settings.sound ? "on" : "off");
    writeCookie(TRANSITION_COOKIE, settings.transition ? "on" : "off");
  }, [settings]);

  const setMode = useCallback((mode: ThemeMode) => {
    setSettings((current) => ({ ...current, mode }));
  }, []);

  const setAccent = useCallback((accent: Accent) => {
    setSettings((current) => ({ ...current, accent }));
  }, []);

  const setMotion = useCallback((motion: boolean) => {
    setSettings((current) => ({ ...current, motion }));
  }, []);

  const setSound = useCallback((sound: boolean) => {
    setSettings((current) => ({ ...current, sound }));
  }, []);

  const setTransition = useCallback((transition: boolean) => {
    setSettings((current) => ({ ...current, transition }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT_THEME), []);

  const value = useMemo(
    () => ({ settings, setMode, setAccent, setMotion, setSound, setTransition, reset }),
    [settings, setMode, setAccent, setMotion, setSound, setTransition, reset],
  );

  return (
    <MotionConfig reducedMotion="user">
      <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    </MotionConfig>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider.");
  return value;
}

/** True when both the app setting and the OS allow animation. */
export function useMotionEnabled(): boolean {
  const { settings } = useTheme();
  const prefersReduced = useReducedMotion();
  return settings.motion && !prefersReduced;
}
