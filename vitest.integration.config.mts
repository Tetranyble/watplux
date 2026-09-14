import { defineConfig } from "vitest/config";

/**
 * Separate config from vitest.config.mts (unit tests): integration tests
 * need the REAL DATABASE_URL (loaded via tests/integration/setup.ts), not
 * the fake override the unit-test config uses. Kept as a distinct config
 * file rather than a single merged one so neither suite can accidentally
 * inherit the other's environment.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    env: {
      BETTER_AUTH_SECRET: "integration-test-only-better-auth-secret-32-chars",
      NODE_ENV: "test",
    },
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    // Real DB round trips (transactions, Argon2 hashing) are slower than
    // the unit suite's injected fakes.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Auth integration tests share tables (users, sessions, ...) — run
    // sequentially within a file to avoid cross-test interference from
    // concurrent writes to the same seeded roles/permissions.
    fileParallelism: false,
  },
});
