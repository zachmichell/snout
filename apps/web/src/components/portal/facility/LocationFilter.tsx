import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Loc = { id: string; name: string };

export default function LocationFilter({
  locations,
  value,
  onChange,
}: {
  locations: Loc[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (locations.length <= 1) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[220px] bg-card">
        <SelectValue placeholder="All locations" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All locations</SelectItem>
        {locations.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
