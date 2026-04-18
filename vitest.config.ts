import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Use vitest's default include (**/*.{test,spec}.ts) so this config works
    // both when run from the workspace root AND from inside a single package
    // (via `pnpm --filter @factory5/state test`). The default already excludes
    // node_modules and dist; we add nothing extra.
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Stub packages have no tests yet — don't fail the workspace run on that.
    // Real packages (core, logger, state, ipc, brain) all have tests and will
    // still report failures normally.
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      exclude: ['**/dist/**', '**/*.config.ts', '**/*.test.ts', '**/*.spec.ts'],
    },
  },
});
