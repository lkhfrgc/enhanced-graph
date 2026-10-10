import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores, defineConfig } from "eslint/config";

// The plugin reviewer's own config, copied from
// `obsidianmd/obsidian-sample-plugin/eslint.config.mts` so a submission failure is
// reproduced here rather than discovered by the reviewer. Kept separate from the
// repository's scripts because it is a check on a submission, not part of the build.
//
// Same form as the sample, `...obsidianmd.configs.recommended` included: those configs
// carry their own `files` patterns, and re-wrapping them in a `defineConfig` object with
// a `files` key rewrites the patterns so the type-aware rules stop applying.
export default defineConfig(
  globalIgnores([
    "node_modules",
    "dist",
    "esbuild.config.mjs",
    "versions.json",
    "main.js",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "harness",
    "scripts",
    "test",
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["manifest.json"],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".json"],
      },
    },
  },
  ...obsidianmd.configs.recommended,
);
