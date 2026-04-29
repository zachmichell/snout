import { useCallback } from "react";
import { useActiveStaff } from "@/contexts/StaffCodeContext";
import { useAuth } from "@/hooks/useAuth";
import { logActivity, ActivityActor } from "@/lib/activity";

/**
 * React hook returning a `log` function that auto-attaches the current actor
 * (active staff PIN, or the org-level signed-in user as fallback) so callers
 * don't have to plumb that context through every mutation.
 *
 * For owner-portal mutations, prefer calling `logActivity` directly with an
 * explicit `actor: { kind: "owner", label: "Owner" }`.
 */
export function useLogActivity() {
  const { activeStaff } = useActiveStaff();
  const { profile } = useAuth();

  return useCallback(
    async (params: Omit<Parameters<typeof logActivity>[0], "actor">) => {
      let actor: ActivityActor;
      if (activeStaff) {
        actor = {
          kind: "staff",
          label: activeStaff.display_name || "Staff",
          staff_code_id: activeStaff.id,
        };
      } else if (profile) {
        const name =
          [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
          profile.email ||
          "Staff";
        actor = { kind: "staff", label: name };
      } else {
        actor = { kind: "system", label: "System" };
      }
      await logActivity({ ...params, actor });
    },
    [activeStaff, profile],
  );
}
