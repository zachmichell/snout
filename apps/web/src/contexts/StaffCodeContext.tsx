import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useStaffCodes } from "@/hooks/useStaffCodes";

export type ActiveStaffCode = {
  id: string;
  display_name: string;
  role: string;
};

type Ctx = {
  activeStaff: ActiveStaffCode | null;
  setActiveStaff: (s: ActiveStaffCode | null) => void;
  clearActiveStaff: () => void;
};

const StaffCodeCtx = createContext<Ctx | undefined>(undefined);

const STORAGE_KEY = "snout_active_staff_code";

export function StaffCodeProvider({ children }: { children: ReactNode }) {
  const { membership } = useAuth();
  const { data: codes } = useStaffCodes();
  const [activeStaff, setActiveStaffState] = useState<ActiveStaffCode | null>(null);

  // Load from sessionStorage on mount / when org changes. Treat the stored
  // row as provisional — a later effect re-validates against server truth.
  useEffect(() => {
    if (!membership?.organization_id) {
      setActiveStaffState(null);
      return;
    }
    try {
      const raw = sessionStorage.getItem(`${STORAGE_KEY}_${membership.organization_id}`);
      if (raw) setActiveStaffState(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, [membership?.organization_id]);

  const setActiveStaff = useCallback(
    (s: ActiveStaffCode | null) => {
      setActiveStaffState(s);
      if (!membership?.organization_id) return;
      const k = `${STORAGE_KEY}_${membership.organization_id}`;
      if (s) {
        sessionStorage.setItem(k, JSON.stringify(s));
      } else {
        sessionStorage.removeItem(k);
      }
    },
    [membership?.organization_id],
  );

  const clearActiveStaff = useCallback(() => setActiveStaff(null), [setActiveStaff]);

  // Re-validate the stored staff code against server-truth whenever the
  // RLS-gated staff_codes list arrives. Any field (role, display_name) from
  // sessionStorage is forgeable by a local attacker; the authoritative
  // values come from the DB row, and a missing/inactive/cross-org row
  // means the stored identity is stale or fabricated and must be cleared.
  useEffect(() => {
    if (!activeStaff?.id || !codes) return;
    const orgId = membership?.organization_id;
    const server = codes.find((c) => c.id === activeStaff.id);
    if (!server || !server.is_active || server.organization_id !== orgId) {
      setActiveStaff(null);
      return;
    }
    if (
      server.display_name !== activeStaff.display_name ||
      server.role !== activeStaff.role
    ) {
      setActiveStaff({
        id: server.id,
        display_name: server.display_name,
        role: server.role,
      });
    }
  }, [codes, activeStaff?.id, activeStaff?.display_name, activeStaff?.role, membership?.organization_id, setActiveStaff]);

  return (
    <StaffCodeCtx.Provider value={{ activeStaff, setActiveStaff, clearActiveStaff }}>
      {children}
    </StaffCodeCtx.Provider>
  );
}

export function useActiveStaff() {
  const ctx = useContext(StaffCodeCtx);
  if (!ctx) {
    // Safe fallback so components outside the provider don't crash
    return { activeStaff: null, setActiveStaff: () => {}, clearActiveStaff: () => {} } as Ctx;
  }
  return ctx;
}
