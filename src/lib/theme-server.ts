import { cookies } from "next/headers";
import {
  ACCENT_COOKIE,
  MOTION_COOKIE,
  SOUND_COOKIE,
  THEME_COOKIE,
  TRANSITION_COOKIE,
  parseThemeSettings,
  type ThemeSettings,
} from "@/lib/theme";

/**
 * Read the appearance cookies in a server component.
 *
 * Reading cookies makes the route dynamic, which every data screen in this
 * app already is. It buys a server-rendered theme, so the first paint is
 * already the right colour instead of flashing the default.
 */
export async function getThemeSettings(): Promise<ThemeSettings> {
  const store = await cookies();
  return parseThemeSettings({
    mode: store.get(THEME_COOKIE)?.value,
    accent: store.get(ACCENT_COOKIE)?.value,
    motion: store.get(MOTION_COOKIE)?.value,
    sound: store.get(SOUND_COOKIE)?.value,
    transition: store.get(TRANSITION_COOKIE)?.value,
  });
}
