import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Service-role client used by integration tests. Bypasses RLS so tests can
 * seed and assert without needing to mint user sessions. Do not use this in
 * production code.
 */
export function createTestClient(): SupabaseClient<Database> {
  const url = process.env.SUPABASE_TEST_URL;
  const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_TEST_URL or SUPABASE_TEST_SERVICE_ROLE_KEY missing");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
