import { beforeAll } from "vitest";

// Integration tests need a Supabase instance reachable via service role. Local
// dev (npx supabase start) is the expected path; a dedicated staging or test
// project also works. Production should never be set here. Fail loudly if the
// env is not set so a misconfigured run cannot accidentally hit the wrong DB.
beforeAll(() => {
  const url = process.env.SUPABASE_TEST_URL;
  const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      [
        "Integration tests require SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_ROLE_KEY.",
        "Local setup:",
        "  1. npx supabase start",
        "  2. Copy the API URL and service_role key from the output.",
        "  3. Add them to .env.test as SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_ROLE_KEY.",
        "  4. Run: npm run test:integration",
        "Or, to point at a non-local project (staging, dev), set the same vars",
        "and SUPABASE_TEST_ALLOW_NONLOCAL=1.",
        "See TESTING.md for the full walkthrough.",
      ].join("\n"),
    );
  }
  const isLocal = /127\.0\.0\.1|localhost/.test(url);
  const explicitOk = process.env.SUPABASE_TEST_ALLOW_NONLOCAL === "1";
  if (!isLocal && !explicitOk) {
    throw new Error(
      `Refusing to run integration tests against ${url}. ` +
        "Local URLs (127.0.0.1, localhost) run by default. To run against a " +
        "non-local project, set SUPABASE_TEST_ALLOW_NONLOCAL=1.",
    );
  }
});
