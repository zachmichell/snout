import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { Groomer } from "@/hooks/useGroomers";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SPECIALTY_SUGGESTIONS = [
  "Large Breeds", "Small Breeds", "Hand Stripping", "Cat Grooming",
  "Doodle Cuts", "Show Grooming", "Senior Pets", "Anxious Pets",
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groomer?: Groomer | null;
}

export default function GroomerFormDialog({ open, onOpenChange, groomer }: Props) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const isEdit = !!groomer;

  const [displayName, setDisplayName] = useState("");
  const [staffMemberId, setStaffMemberId] = useState<string>("none");
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [specialtyInput, setSpecialtyInput] = useState("");
  const [certifications, setCertifications] = useState<string[]>([]);
  const [certInput, setCertInput] = useState("");
  const [commissionRate, setCommissionRate] = useState<string>("");
  const [maxAppts, setMaxAppts] = useState<string>("8");
  const [workingDays, setWorkingDays] = useState<string[]>(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  const [bio, setBio] = useState("");
  const [active, setActive] = useState(true);

  const { data: staff = [] } = useQuery({
    queryKey: ["org-staff-profiles", orgId],
    enabled: !!orgId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("memberships")
        .select("profile_id, profiles:profile_id(id, first_name, last_name, email)")
        .eq("organization_id", orgId!)
        .eq("active", true);
      if (error) throw error;
      return (data ?? []).map((m: any) => m.profiles).filter(Boolean);
    },
  });

  useEffect(() => {
    if (!open) return;
    if (groomer) {
      setDisplayName(groomer.display_name);
      setStaffMemberId(groomer.staff_member_id ?? "none");
      setSpecialties(groomer.specialties ?? []);
      setCertifications(groomer.certifications ?? []);
      setCommissionRate(groomer.commission_rate_percent != null ? String(groomer.commission_rate_percent) : "");
      setMaxAppts(String(groomer.max_appointments_per_day ?? 8));
      setWorkingDays(groomer.working_days ?? []);
      setBio(groomer.bio ?? "");
      setActive(groomer.status === "active");
    } else {
      setDisplayName("");
      setStaffMemberId("none");
      setSpecialties([]);
      setCertifications([]);
      setCommissionRate("");
      setMaxAppts("8");
      setWorkingDays(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
      setBio("");
      setActive(true);
    }
    setSpecialtyInput("");
    setCertInput("");
  }, [open, groomer]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No org");
      if (!displayName.trim()) throw new Error("Display name is required");
      const payload = {
        organization_id: orgId,
        staff_member_id: staffMemberId === "none" ? null : staffMemberId,
        display_name: displayName.trim(),
        specialties,
        certifications,
        commission_rate_percent: commissionRate ? parseInt(commissionRate, 10) : null,
        max_appointments_per_day: parseInt(maxAppts, 10) || 8,
        working_days: workingDays,
        bio: bio.trim() || null,
        status: active ? "active" : "inactive",
      };
      if (isEdit && groomer) {
        const { error } = await supabase.from("groomers").update(payload).eq("id", groomer.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("groomers").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Groomer updated" : "Groomer added");
      qc.invalidateQueries({ queryKey: ["groomers"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  const addTag = (kind: "spec" | "cert", value: string) => {
    const v = value.trim();
    if (!v) return;
    if (kind === "spec") {
      if (!specialties.includes(v)) setSpecialties([...specialties, v]);
      setSpecialtyInput("");
    } else {
      if (!certifications.includes(v)) setCertifications([...certifications, v]);
      setCertInput("");
    }
  };

  const removeTag = (kind: "spec" | "cert", value: string) => {
    if (kind === "spec") setSpecialties(specialties.filter((s) => s !== value));
    else setCertifications(certifications.filter((c) => c !== value));
  };

  const toggleDay = (d: string) => {
    setWorkingDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{isEdit ? "Edit Groomer" : "Add Groomer"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Display Name *</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g., Sarah Johnson" />
            </div>
            <div>
              <Label>Linked Team Member</Label>
              <Select value={staffMemberId} onValueChange={setStaffMemberId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {staff.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {[s.first_name, s.last_name].filter(Boolean).join(" ") || s.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Specialties</Label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {specialties.map((s) => (
                <Badge key={s} variant="secondary" className="gap-1">
                  {s}
                  <button onClick={() => removeTag("spec", s)} type="button"><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
            <Input
              value={specialtyInput}
              onChange={(e) => setSpecialtyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag("spec", specialtyInput); } }}
              placeholder="Type and press Enter"
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {SPECIALTY_SUGGESTIONS.filter((s) => !specialties.includes(s)).map((s) => (
                <button key={s} type="button" onClick={() => addTag("spec", s)}
                  className="text-xs px-2 py-0.5 rounded-full border border-border text-text-secondary hover:bg-accent">
                  + {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Certifications</Label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {certifications.map((c) => (
                <Badge key={c} variant="secondary" className="gap-1">
                  {c}
                  <button onClick={() => removeTag("cert", c)} type="button"><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
            <Input
              value={certInput}
              onChange={(e) => setCertInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag("cert", certInput); } }}
              placeholder="e.g., NDGAA Certified — type and press Enter"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Commission Rate (%)</Label>
              <Input type="number" min={0} max={100} value={commissionRate}
                onChange={(e) => setCommissionRate(e.target.value)} placeholder="e.g., 50" />
            </div>
            <div>
              <Label>Max Appointments / Day</Label>
              <Input type="number" min={1} value={maxAppts} onChange={(e) => setMaxAppts(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Working Days</Label>
            <div className="grid grid-cols-7 gap-2 mt-2">
              {WEEKDAYS.map((d) => (
                <label key={d} className="flex flex-col items-center gap-1 text-xs cursor-pointer">
                  <Checkbox checked={workingDays.includes(d)} onCheckedChange={() => toggleDay(d)} />
                  <span className="text-text-secondary">{d.slice(0, 3)}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label>Bio</Label>
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder="Optional bio or notes" />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
            <div>
              <div className="text-sm font-medium">Active</div>
              <div className="text-xs text-text-secondary">Inactive groomers won't appear in appointment dropdowns</div>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving..." : isEdit ? "Save Changes" : "Add Groomer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
