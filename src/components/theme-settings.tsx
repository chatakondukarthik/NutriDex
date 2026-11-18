"use client";

import { motion } from "motion/react";
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "@/components/icons";
import { useMotionEnabled, useTheme } from "@/components/theme-provider";
import {
  ACCENTS,
  ACCENT_LABELS,
  ACCENT_PREVIEW,
  MODE_DESCRIPTIONS,
  MODE_LABELS,
  THEME_MODES,
} from "@/lib/theme";
import { cn } from "@/lib/cn";

const MODE_ICONS = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon,
};

export function ThemeSettingsPanel() {
  const { settings, setMode, setAccent, setMotion, setSound, setTransition, reset } = useTheme();
  const motionEnabled = useMotionEnabled();

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-sm font-semibold tracking-tight text-ink">Appearance</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          These tokens are used by every screen. Add a new page and it inherits the
          same palette, radius and motion rules.
        </p>

        <div className="mt-5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
            Mode
          </span>
          <div
            role="group"
            aria-label="Colour mode"
            className="mt-1.5 flex rounded-control bg-ink/5 p-1"
          >
            {THEME_MODES.map((mode) => {
              const Icon = MODE_ICONS[mode];
              const active = settings.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setMode(mode)}
                  aria-pressed={active}
                  className={cn(
                    "relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition",
                    active ? "text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="theme-mode-pill"
                      className="absolute inset-0 rounded-lg bg-surface shadow-sm"
                      transition={
                        motionEnabled
                          ? { type: "spring", stiffness: 420, damping: 34 }
                          : { duration: 0 }
                      }
                    />
                  )}
                  <span className="relative flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5" />
                    {MODE_LABELS[mode]}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-faint">{MODE_DESCRIPTIONS[settings.mode]}</p>
        </div>

        <div className="mt-5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
            Accent
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {ACCENTS.map((accent) => {
              const active = settings.accent === accent;
              return (
                <button
                  key={accent}
                  type="button"
                  onClick={() => setAccent(accent)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-2 rounded-control border px-2.5 py-1.5 text-xs font-medium transition",
                    active
                      ? "border-accent/50 bg-accent/10 text-ink"
                      : "border-line text-muted hover:border-line-strong hover:text-ink",
                  )}
                >
                  <span
                    className="grid h-4 w-4 place-items-center rounded-full"
                    style={{ background: ACCENT_PREVIEW[accent] }}
                  >
                    {active && <CheckIcon className="h-2.5 w-2.5 text-accent-ink" />}
                  </span>
                  {ACCENT_LABELS[accent]}
                </button>
              );
            })}
          </div>
        </div>

        {[
          {
            label: "Motion",
            hint: "Springs, list drops and the thali tilt. The system setting always wins.",
            checked: settings.motion,
            onToggle: () => setMotion(!settings.motion),
            aria: "Enable motion",
          },
          {
            label: "Sound effects",
            hint: "A quiet kitchen whisper for saves, streaks and mis-steps. Off mutes everything.",
            checked: settings.sound,
            onToggle: () => setSound(!settings.sound),
            aria: "Enable sound effects",
          },
          {
            label: "Chef's transition",
            hint: "The corner plate folds into the next room's plate when you switch tabs. Off swaps instantly.",
            checked: settings.transition,
            onToggle: () => setTransition(!settings.transition),
            aria: "Enable the fold transition",
          },
        ].map((option) => (
          <div
            key={option.label}
            className="mt-4 flex items-start justify-between gap-4 rounded-control border border-line bg-surface-2 px-3 py-3 first:mt-5"
          >
            <div>
              <div className="text-xs font-medium">{option.label}</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{option.hint}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={option.checked}
              aria-label={option.aria}
              onClick={option.onToggle}
              className={cn(
                "relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition",
                option.checked ? "bg-accent" : "bg-ink/15",
              )}
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface shadow-sm transition-transform",
                  option.checked ? "translate-x-4" : "translate-x-0",
                )}
              />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={reset}
          className="mt-4 text-[11px] font-medium text-muted underline underline-offset-2 transition hover:text-ink"
        >
          Reset to defaults
        </button>
      </section>

      <aside className="lg:sticky lg:top-20">
        <section className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h2 className="font-display text-sm font-semibold tracking-tight text-ink">Preview</h2>
          <p className="mt-1 text-xs text-muted">A card, a control and a progress bar.</p>

          <div className="mt-4 rounded-control border border-line bg-surface-2 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium">Paneer bhurji</span>
              <span className="tabular text-[11px] text-muted">338 kcal</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
              <div className="bar-fill h-full w-[62%] rounded-full bg-accent" />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                className="rounded-control bg-accent px-3 py-1.5 text-[11px] font-medium text-accent-ink transition hover:bg-accent-strong"
              >
                Primary
              </button>
              <button
                type="button"
                className="rounded-control border border-line px-3 py-1.5 text-[11px] font-medium text-muted transition hover:border-line-strong hover:text-ink"
              >
                Secondary
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-2" aria-hidden="true">
            <div className="skeleton h-3 w-3/4" />
            <div className="skeleton h-3 w-1/2" />
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-faint">
            Saved in this browser. No account, no sync.
          </p>
        </section>
      </aside>
    </div>
  );
}
