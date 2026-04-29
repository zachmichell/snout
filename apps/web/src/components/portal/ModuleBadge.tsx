import StatusBadge from "./StatusBadge";
import { formatModule } from "@/lib/money";

export default function ModuleBadge({ module }: { module: string }) {
  // daycare → Morning Mist family (success), boarding → Plum family
  const tone = module === "boarding" ? "plum" : module === "daycare" ? "success" : "muted";
  return <StatusBadge tone={tone}>{formatModule(module)}</StatusBadge>;
}
