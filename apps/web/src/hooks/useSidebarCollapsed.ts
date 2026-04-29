import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "snout.sidebar.collapsed";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(readInitial);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // Sync across tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setCollapsed(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  return { collapsed, toggle, setCollapsed };
}
