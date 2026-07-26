import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Git worktrees live under .claude/worktrees/ INSIDE this repo, so the default globs pick up a
    // second copy of every test file. That double-counts the suite and lets stale worktree code fail
    // a run of the main checkout. Only ever test the files in this working tree.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
