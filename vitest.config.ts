import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      {
        // Pure logic, the nutrition engine, repositories against a real
        // SQLite file, and server-side derivations. No DOM.
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // React components in jsdom: interaction, keyboard, ARIA and state.
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "component",
          include: ["tests/components/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./tests/setup/dom.ts"],
          restoreMocks: true,
        },
      },
    ],
  },
});
