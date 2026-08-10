import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    },
  },
  // Override NODE_ENV=production from .env so React exports `act` for @testing-library/react
  define: {
    'process.env.NODE_ENV': '"test"',
  },
  test: {
    globals: true,
    environment: 'jsdom',
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
      '**/*.spec.ts'  // Playwright tests use .spec.ts
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
