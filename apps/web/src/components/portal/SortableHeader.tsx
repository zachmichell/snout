import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc" | null;

export type SortState = { column: string; dir: Exclude<SortDir, null> } | null;

export function nextSort(current: SortState, column: string): SortState {
  if (!current || current.column !== column) return { column, dir: "asc" };
  if (current.dir === "asc") return { column, dir: "desc" };
  return null;
}

export default function SortableHeader({
  column,
  sort,
  onSort,
  children,
  className,
}: {
  column: string;
  sort: SortState;
  onSort: (next: SortState) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const active = sort?.column === column;
  const Icon = active ? (sort!.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={cn("px-[18px] py-[14px] label-eyebrow", className)}>
      <button
        type="button"
        onClick={() => onSort(nextSort(sort, column))}
        className={cn(
          "inline-flex items-center gap-1.5 hover:text-foreground transition-colors",
          active ? "text-foreground" : "text-text-tertiary",
        )}
      >
        <span>{children}</span>
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
}
