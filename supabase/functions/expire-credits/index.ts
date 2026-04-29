// Cron-callable expiration sweep. Runs the SQL expire_credits function for
// every active organization. The SQL function is idempotent, so running this
// more often than strictly needed is harmless.
//
// Wire to a schedule via Supabase pg_cron or an external scheduler:
//   curl -H "Authorization: Bearer <service_role_key>" https://<project>.functions.supabase.co/expire-credits
//
// Returns a summary of how many expiration rows were written per org.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: orgs, error: orgsErr } = await sb
      .from("organizations")
      .select("id, name")
      .is("deleted_at", null);

    if (orgsErr) throw orgsErr;

    const summary: Array<{ org: string; expired: number }> = [];
    for (const org of orgs ?? []) {
      const { data, error } = await sb.rpc("expire_credits", { p_organization_id: org.id });
      if (error) {
        console.error(`expire_credits failed for org ${org.id}`, error);
        continue;
      }
      const expired = (data as { expired_count?: number } | null)?.expired_count ?? 0;
      summary.push({ org: org.name ?? org.id, expired });
    }

    const total = summary.reduce((acc, s) => acc + s.expired, 0);
    return new Response(JSON.stringify({ success: true, total, summary }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`expire-credits error [${errorId}]:`, err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal error", error_id: errorId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
