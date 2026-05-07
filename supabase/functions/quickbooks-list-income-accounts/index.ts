// 6.6c: List the operator's QBO Income accounts so the settings UI can
// offer them as options for the Expired Credits Income picker. Same shape
// as quickbooks-list-fee-accounts and quickbooks-list-liability-accounts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { requireOrgAdmin } from "../_shared/auth.ts";
import { getTokenContext, listIncomeAccounts } from "../_shared/quickbooks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTUIT_CLIENT_ID = Deno.env.get("INTUIT_CLIENT_ID");
const INTUIT_CLIENT_SECRET = Deno.env.get("INTUIT_CLIENT_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!INTUIT_CLIENT_ID || !INTUIT_CLIENT_SECRET) {
    return json({ error: "QBO not configured" }, 503);
  }
  const ctx = await requireOrgAdmin(req);
  if (!ctx) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const tokens = await getTokenContext({
    admin,
    orgId: ctx.orgId,
    clientId: INTUIT_CLIENT_ID,
    clientSecret: INTUIT_CLIENT_SECRET,
  });
  if (!tokens) return json({ error: "QBO not connected" }, 400);

  const res = await listIncomeAccounts(tokens);
  if (!res.ok) return json({ error: res.error }, 502);

  return json({
    accounts: res.data.map((a) => ({
      id: a.Id,
      name: a.Name,
      type: a.AccountType,
      subType: a.AccountSubType ?? null,
    })),
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
