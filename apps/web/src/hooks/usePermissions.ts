import { useAuth } from "./useAuth";
import { hasPermission, type Permission, type Role } from "@/lib/permissions";

export function usePermissions() {
  const { membership, loading } = useAuth();
  const role = (membership?.role ?? null) as Role | null;
  const can = (permission: Permission) => hasPermission(role, permission);
  return { role, can, isLoading: loading };
}
