import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Keep runtime writes inside this worktree when node_modules is shared read-only.
  cacheDir: fileURLToPath(new URL('./.cache/vitest', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  // Override NODE_ENV=production from .env so React exports `act` for @testing-library/react
  define: {
    'process.env.NODE_ENV': '"test"',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // ADR-203 G9: pin the per-test timeout explicitly instead of inheriting
    // Vitest's Node/jsdom default (5000 ms; browser mode would be 15000).
    // Per-test and container-wrapper timeouts set inline still take precedence.
    testTimeout: 5000,
    setupFiles: [
      './backend/test/setup.js',   // ADR-0009 Phase 5: boot guard (MUST be first)
      './src/tests/setup.ts',
      './backend/tests/setup.js'  // Backend test environment setup
    ],
    // Exclude e2e tests (Playwright) from vitest
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/.claude/worktrees/**',
      '**/*.spec.ts',  // Playwright tests use .spec.ts
      // Repo-root `components/` is an unreferenced duplicate of
      // src/features/ai-chat/components/AIChatPanel, untouched since the initial
      // commit: no file under src/ resolves into it (the neighbouring
      // `../../../../components/...` imports all land inside src/features/ai-chat)
      // and it is unreachable from src/main.tsx. Its 9 suites tested that stale
      // copy and contributed 6 recorded failures — assertions about a UI the live
      // tree shipped differently. Excluded rather than deleted: dropping 132
      // orphaned source files is the owner's call, not a side effect of a test fix.
      'components/**',
      // Framework-free plain-Node script that happens to match *.test.mjs.
      // vitest collected it, found no describe/it and reported "No test suite
      // found" — a permanent red entry for a script that passes. It still runs
      // in `npm test`, via scripts/__tests__/strip-test-scripts.wrapper.test.mjs.
      'scripts/strip-test-scripts.test.mjs',
      // node:test suites run in the mandatory wrapper below, never on the host.
      // Keep these paths paired with scripts/__tests__/node-container.wrapper.test.mjs.
      'deploy-bot/mcp-preservation.test.cjs',
      'scripts/public-router.test.cjs',
      'scripts/ops-runner/isolation.test.cjs',
      'scripts/staging-browser/inspection.test.mjs',
      // Runs only in the Chromium QA image (backend/config/ops-suites.json,
      // profile browser-test); on the host vitest sees no suite and reports red.
      'scripts/ops-runner/browser-isolation.test.cjs'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  }
});
