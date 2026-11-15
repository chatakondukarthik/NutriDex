"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "@/components/icons";
import { useTheme } from "@/components/theme-provider";
import { MODE_LABELS, type ThemeMode } from "@/lib/theme";

const ORDER: ThemeMode[] = ["light", "dark", "system"];

const ICONS = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

/** A one-tap cycle: light → dark → follow the system. */
export function ThemeToggle() {
  const { settings, setMode } = useTheme();
  const Icon = ICONS[settings.mode];
  const next = ORDER[(ORDER.indexOf(settings.mode) + 1) % ORDER.length];

  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      aria-label={`Theme: ${MODE_LABELS[settings.mode]}. Switch to ${MODE_LABELS[next]}.`}
      title={`Theme: ${MODE_LABELS[settings.mode]}`}
      className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-ink/5 hover:text-ink"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
