import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocations } from "@/hooks/useLocations";

const STORAGE_KEY = "snout.selectedLocationId";

export type LocationSelection = string | "all";

type LocationContextValue = {
  selectedLocationId: LocationSelection;
  setSelectedLocationId: (id: LocationSelection) => void;
  /** Returns the selected location id, or `null` if "all" is selected (no filter). */
  filterId: string | null;
  locations: Array<{ id: string; name: string }>;
  isLoading: boolean;
};

const LocationContext = createContext<LocationContextValue | undefined>(undefined);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const { data: locations = [], isLoading } = useLocations();

  const [selectedLocationId, setSelectedLocationIdState] = useState<LocationSelection>(() => {
    if (typeof window === "undefined") return "all";
    return (window.localStorage.getItem(STORAGE_KEY) as LocationSelection) || "all";
  });

  // If the persisted id no longer exists in the user's org locations, fall back to "all".
  useEffect(() => {
    if (selectedLocationId === "all") return;
    if (!locations.length) return;
    if (!locations.some((l) => l.id === selectedLocationId)) {
      setSelectedLocationIdState("all");
      window.localStorage.setItem(STORAGE_KEY, "all");
    }
  }, [locations, selectedLocationId]);

  const setSelectedLocationId = useCallback((id: LocationSelection) => {
    setSelectedLocationIdState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<LocationContextValue>(
    () => ({
      selectedLocationId,
      setSelectedLocationId,
      filterId: selectedLocationId === "all" ? null : selectedLocationId,
      locations,
      isLoading,
    }),
    [selectedLocationId, setSelectedLocationId, locations, isLoading],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocationContext() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useLocationContext must be used within a LocationProvider");
  return ctx;
}

/**
 * Convenience hook: returns the location id to filter by, or `null` for "all locations".
 * Use in queryKeys to invalidate when the selection changes.
 */
export function useLocationFilter() {
  return useLocationContext().filterId;
}
