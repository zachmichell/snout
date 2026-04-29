import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

// Note: pin_code was removed from the client type in favour of server-side
// verification via the verify_staff_pin RPC. The raw PIN is never fetched
// into the browser anymore — admins set PINs through create_staff_code /
// update_staff_code_pin RPCs, which hash server-side.
export type StaffCode = {
  id: string;
  organization_id: string;
  profile_id: string | null;
  display_name: string;
  role: "owner" | "admin" | "manager" | "staff" | "groomer";
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

const STAFF_CODE_COLUMNS =
  "id, organization_id, profile_id, display_name, role, is_active, last_used_at, created_at, updated_at";

export function useStaffCodes() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  return useQuery({
    enabled: !!orgId,
    queryKey: ["staff-codes", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_codes")
        .select(STAFF_CODE_COLUMNS)
        .eq("organization_id", orgId!)
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as StaffCode[];
    },
  });
}

export function useCreateStaffCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      display_name: string;
      pin_code: string;
      role: StaffCode["role"];
    }) => {
      const { data, error } = await supabase.rpc("create_staff_code", {
        _display_name: input.display_name,
        _pin: input.pin_code,
        _role: input.role,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff-codes"] }),
  });
}

// Updates non-PIN fields (display_name, role, is_active). Changing the PIN
// goes through useUpdateStaffCodePin so the hashing stays server-side.
export function useUpdateStaffCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      display_name?: string;
      role?: StaffCode["role"];
      is_active?: boolean;
    }) => {
      const { id, ...patch } = input;
      const { data, error } = await supabase
        .from("staff_codes")
        .update(patch)
        .eq("id", id)
        .select(STAFF_CODE_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff-codes"] }),
  });
}

export function useUpdateStaffCodePin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; pin_code: string }) => {
      const { error } = await supabase.rpc("update_staff_code_pin", {
        _id: input.id,
        _new_pin: input.pin_code,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff-codes"] }),
  });
}

export function useDeleteStaffCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff_codes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff-codes"] }),
  });
}

// Server-side PIN verification. Returns the matched staff_code id, or null
// if the PIN doesn't match any active code in the caller's org. The
// last_used_at touch happens inside the RPC atomically.
export function useVerifyStaffPin() {
  return useMutation({
    mutationFn: async (input: { org_id: string; pin: string }) => {
      const { data, error } = await supabase.rpc("verify_staff_pin", {
        _org_id: input.org_id,
        _pin: input.pin,
      });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });
}
