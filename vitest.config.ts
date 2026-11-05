import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // AI tests touch a local SQLite file and a deterministic mock; keep each
    // worker isolated with its own DB_FILE (set inside the test file).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
