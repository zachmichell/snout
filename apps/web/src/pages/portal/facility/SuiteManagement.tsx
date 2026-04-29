import { useMemo, useState } from "react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import StatusBadge from "@/components/portal/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Plus, Trash2, DoorOpen } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatCentsShort } from "@/lib/money";
import { useSuites, type SuiteRow } from "@/hooks/useSuites";
import SuiteFormDialog from "./SuiteFormDialog";

const TYPE_TONES: Record<SuiteRow["type"], "muted" | "primary" | "plum"> = {
  standard: "muted",
  deluxe: "primary",
  presidential: "plum",
};

type SortKey = "name" | "type" | "status";
type FilterKey = "all" | "active" | "inactive";

export function SuiteManagementSection() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const { data: suites = [], isLoading } = useSuites();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SuiteRow | null>(null);
  const [deleting, setDeleting] = useState<SuiteRow | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [filter, setFilter] = useState<FilterKey>("all");

  // Find current occupants (checked-in reservations with a suite_id)
  const { data: occupants = [] } = useQuery({
    queryKey: ["suite-occupants", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select("suite_id, reservation_pets(pets(name))")
        .eq("organization_id", orgId!)
        .eq("status", "checked_in")
        .not("suite_id", "is", null)
        .is("deleted_at", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const occupantBySuite = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of occupants as any[]) {
      const names = (r.reservation_pets ?? [])
        .map((rp: any) => rp.pets?.name)
        .filter(Boolean)
        .join(", ");
      if (r.suite_id && names) m.set(r.suite_id, names);
    }
    return m;
  }, [occupants]);

  const filtered = useMemo(() => {
    let list = [...suites];
    if (filter === "active") list = list.filter((s) => s.status === "active");
    if (filter === "inactive") list = list.filter((s) => s.status === "inactive");
    list.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "type") return a.type.localeCompare(b.type);
      return a.status.localeCompare(b.status);
    });
    return list;
  }, [suites, filter, sortKey]);

  const toggleStatus = useMutation({
    mutationFn: async (s: SuiteRow) => {
      const { error } = await supabase
        .from("suites")
        .update({ status: s.status === "active" ? "inactive" : "active" })
        .eq("id", s.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suites"] });
      toast.success("Suite updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (s: SuiteRow) => {
      const { error } = await supabase
        .from("suites")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", s.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suites"] });
      toast.success("Suite deleted");
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
    <div className="px-8 py-6">
        <PageHeader
          title="Suite Management"
          description="Manage your overnight boarding suites"
          actions={
            <div className="flex items-center gap-2">
              <Select value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All suites</SelectItem>
                  <SelectItem value="active">Active only</SelectItem>
                  <SelectItem value="inactive">Inactive only</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Sort: Name</SelectItem>
                  <SelectItem value="type">Sort: Type</SelectItem>
                  <SelectItem value="status">Sort: Status</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> Add suite
              </Button>
            </div>
          }
        />

        {isLoading ? (
          <div className="h-48 animate-pulse rounded-lg bg-surface" />
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface p-12 text-center shadow-card">
            <DoorOpen className="mx-auto h-10 w-10 text-text-tertiary" />
            <div className="mt-3 font-display text-lg">No suites yet</div>
            <p className="mt-1 text-sm text-text-secondary">
              Add your first overnight suite to start managing lodging guests.
            </p>
            <Button
              className="mt-4"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add suite
            </Button>
          </div>
        ) : (
          <Card className="border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Suite name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Daily rate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Current occupant</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => {
                  const occupant = occupantBySuite.get(s.id);
                  return (
                    <TableRow key={s.id} className={s.status === "inactive" ? "opacity-60" : ""}>
                      <TableCell className="font-medium text-foreground">{s.name}</TableCell>
                      <TableCell>
                        <StatusBadge tone={TYPE_TONES[s.type]}>
                          {s.type.charAt(0).toUpperCase() + s.type.slice(1)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-sm">{s.capacity}</TableCell>
                      <TableCell className="text-sm">{formatCentsShort(s.daily_rate_cents)}</TableCell>
                      <TableCell>
                        <button
                          onClick={() => toggleStatus.mutate(s)}
                          aria-label={`Toggle ${s.name} status`}
                        >
                          <StatusBadge tone={s.status === "active" ? "success" : "muted"}>
                            {s.status === "active" ? "Active" : "Inactive"}
                          </StatusBadge>
                        </button>
                      </TableCell>
                      <TableCell className="text-sm">
                        {occupant ? (
                          <span className="text-foreground">{occupant}</span>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(s);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-2 text-destructive hover:text-destructive"
                          onClick={() => setDeleting(s)}
                          aria-label={`Delete ${s.name}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <SuiteFormDialog open={dialogOpen} onOpenChange={setDialogOpen} suite={editing} />

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Delete this suite?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} will be removed from your active suites. Reservations linked to it will keep their record but lose the suite assignment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && remove.mutate(deleting)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function SuiteManagement() {
  return (
    <PortalLayout>
      <SuiteManagementSection />
    </PortalLayout>
  );
}
