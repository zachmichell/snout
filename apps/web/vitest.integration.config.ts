import { defineConfig } from "vitest/config";
import path from "path";

// Integration-test config. These tests hit a real Postgres via a local Supabase
// instance (run "npx supabase start" before invoking) so SQL behavior, RLS,
// and constraints are exercised end-to-end. Node environment, no jsdom, no
// React plugin (we are not rendering components here).
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/integration-setup.ts"],
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration tests share a database. Run them serially to keep failures
    // legible until per-test isolation (truncation in afterEach, or schema
    // sandboxing) lands in a later batch.
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
