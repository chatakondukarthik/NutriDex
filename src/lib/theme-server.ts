import { cookies } from "next/headers";
import {
  ACCENT_COOKIE,
  MOTION_COOKIE,
  THEME_COOKIE,
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
  });
}
