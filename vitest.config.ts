import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      /**
       * The published `obsidian` npm package is **types-only** (`"main": ""`),
       * so Vite cannot resolve a runtime `import ... from "obsidian"` and the
       * whole test file fails to load. Point it at the same stub the browser
       * harness uses, mirroring `esbuild.config.mjs`.
       */
      obsidian: path.join(root, "harness", "obsidian-stub.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
