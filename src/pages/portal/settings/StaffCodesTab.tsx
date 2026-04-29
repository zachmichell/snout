import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Shuffle } from "lucide-react";
import {
  useStaffCodes,
  useCreateStaffCode,
  useUpdateStaffCode,
  useUpdateStaffCodePin,
  useDeleteStaffCode,
  type StaffCode,
} from "@/hooks/useStaffCodes";
import { toast } from "sonner";
import { format } from "date-fns";

const ROLES: { value: StaffCode["role"]; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "staff", label: "Staff" },
  { value: "groomer", label: "Groomer" },
];

function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export default function StaffCodesTab() {
  const { data: codes = [], isLoading } = useStaffCodes();
  const create = useCreateStaffCode();
  const update = useUpdateStaffCode();
  const updatePin = useUpdateStaffCodePin();
  const remove = useDeleteStaffCode();

  const [editing, setEditing] = useState<StaffCode | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    display_name: "",
    pin_code: "",
    role: "staff" as StaffCode["role"],
  });

  const openNew = () => {
    setEditing(null);
    setForm({ display_name: "", pin_code: generatePin(), role: "staff" });
    setShowForm(true);
  };

  // Edit leaves PIN blank — PIN hashes live server-side now, so there's
  // no plaintext to pre-fill. Filling it in and saving rotates the PIN.
  const openEdit = (c: StaffCode) => {
    setEditing(c);
    setForm({ display_name: c.display_name, pin_code: "", role: c.role });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.display_name.trim()) {
      toast.error("Name is required");
      return;
    }
    // On create, PIN is required. On edit, empty PIN means "don't change".
    const wantsPinChange = form.pin_code.length > 0;
    if (!editing || wantsPinChange) {
      if (!/^\d{4,6}$/.test(form.pin_code)) {
        toast.error("PIN must be 4-6 digits");
        return;
      }
    }
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          display_name: form.display_name,
          role: form.role,
        });
        if (wantsPinChange) {
          await updatePin.mutateAsync({ id: editing.id, pin_code: form.pin_code });
        }
        toast.success("Staff code updated");
      } else {
        await create.mutateAsync(form);
        toast.success("Staff code created");
      }
      setShowForm(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    }
  };

  const handleToggleActive = async (c: StaffCode) => {
    try {
      await update.mutateAsync({ id: c.id, is_active: !c.is_active });
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
  };

  const handleDelete = async (c: StaffCode) => {
    if (!confirm(`Delete staff code for ${c.display_name}?`)) return;
    try {
      await remove.mutateAsync(c.id);
      toast.success("Deleted");
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
  };

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg text-foreground">Staff Codes</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Each staff member gets a PIN they enter to identify themselves at this terminal.
            The active PIN determines their permissions and is recorded on logs they create.
          </p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" /> Add Staff Code
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-text-secondary">Loading…</div>
      ) : codes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-text-secondary">
          No staff codes yet. Add one to get started.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>PIN</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.display_name}</TableCell>
                  <TableCell>
                    <span className="font-mono text-text-tertiary">••••</span>
                  </TableCell>
                  <TableCell className="capitalize">{c.role}</TableCell>
                  <TableCell>
                    <Switch checked={c.is_active} onCheckedChange={() => handleToggleActive(c)} />
                  </TableCell>
                  <TableCell className="text-xs text-text-secondary">
                    {c.last_used_at ? format(new Date(c.last_used_at), "MMM d, h:mm a") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)} aria-label="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(c)} aria-label="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit staff code" : "Add staff code"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="display_name">Name</Label>
              <Input
                id="display_name"
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="Jessica"
              />
            </div>
            <div>
              <Label htmlFor="pin">
                PIN (4-6 digits)
                {editing && (
                  <span className="ml-2 text-xs font-normal text-text-tertiary">
                    Leave blank to keep the current PIN
                  </span>
                )}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="pin"
                  inputMode="numeric"
                  maxLength={6}
                  value={form.pin_code}
                  onChange={(e) => setForm({ ...form, pin_code: e.target.value.replace(/\D/g, "") })}
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setForm({ ...form, pin_code: generatePin() })}
                  aria-label="Generate PIN"
                >
                  <Shuffle className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>
              <Label htmlFor="role">Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as StaffCode["role"] })}>
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={create.isPending || update.isPending}>
              {editing ? "Save changes" : "Create code"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
