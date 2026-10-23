import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// Committed test config; values already present in the environment (e.g. CI) win.
dotenv.config({ path: '.env.test', quiet: true });

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    fileParallelism: false, // all files share one Postgres database
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
