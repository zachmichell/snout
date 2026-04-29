import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function usePageSize(storageKey: string, defaultSize = 25) {
  const stored = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
  const initial = stored ? Number(stored) : defaultSize;
  const valid = PAGE_SIZE_OPTIONS.includes(initial) ? initial : defaultSize;
  return valid;
}

export function setStoredPageSize(storageKey: string, size: number) {
  if (typeof window !== "undefined") window.localStorage.setItem(storageKey, String(size));
}

export default function PageSizeSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-text-secondary">
      <span>Rows per page</span>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="h-8 w-[72px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZE_OPTIONS.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
