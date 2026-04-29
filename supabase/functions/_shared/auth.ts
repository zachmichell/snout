// Shared admin/membership gate for processor-management edge functions.
// Resolves the caller from the bearer token, looks up their active
// membership, and returns { orgId, role } if they have admin/owner rights.
// Returns null on any failure path so callers can respond with a 401/403.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

export type AdminContext = {
  userId: string;
  userEmail: string | null;
  orgId: string;
  role: "owner" | "admin";
};

export async function requireOrgAdmin(req: Request): Promise<AdminContext | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims, error } = await userClient.auth.getClaims(
    authHeader.replace("Bearer ", ""),
  );
  if (error || !claims?.claims) return null;

  const userId = claims.claims.sub;
  const userEmail = (claims.claims as any).email as string | undefined;

  const { data: membership } = await userClient
    .from("memberships")
    .select("organization_id, role")
    .eq("profile_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (!membership) return null;
  if (!["owner", "admin"].includes(membership.role)) return null;

  return {
    userId,
    userEmail: userEmail ?? null,
    orgId: membership.organization_id as string,
    role: membership.role as "owner" | "admin",
  };
}
