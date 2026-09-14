import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Native tsconfig-paths resolution (Vite 5.4+/6+) — replaces the
    // vite-tsconfig-paths plugin, one fewer dependency to track.
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // Unit tests never touch a real database (health use-case tests inject
    // a fake ping), so this only needs to satisfy env.ts's schema check.
    env: {
      DATABASE_URL: "mysql://test:test@localhost:3306/watplux_test",
      BETTER_AUTH_SECRET: "unit-test-only-better-auth-secret-32-chars",
      NODE_ENV: "test",
    },
  },
});
