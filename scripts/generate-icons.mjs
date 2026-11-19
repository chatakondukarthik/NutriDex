/**
 * Render public/icon.svg to the PNG sizes PWA + browsers need.
 * Run with:  node scripts/generate-icons.mjs
 * (Sharp is already a dependency — same pattern as the design tooling.)
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";

const svg = readFileSync(new URL("../public/icon.svg", import.meta.url));
const sizes = [16, 32, 48, 180, 192, 512];

const out = Object.fromEntries(
  await Promise.all(
    sizes.map(async (size) => {
      const name =
        size === 180
          ? "apple-touch-icon.png"
          : size === 16 || size === 32 || size === 48
            ? `favicon-${size}x${size}.png`
            : `pwa-${size}x${size}.png`;
      await sharp(svg, { density: 384 }).resize(size, size).png().toFile(`public/${name}`);
      return [name, size];
    }),
  ),
);

console.log("Icons written:");
for (const [name, size] of Object.entries(out)) console.log(`  ${name.padEnd(22)} ${size}px`);
