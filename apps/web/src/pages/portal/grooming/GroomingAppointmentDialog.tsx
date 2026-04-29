import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, AlertTriangle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useGroomers } from "@/hooks/useGroomers";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SERVICE_OPTIONS = [
  "Bath & Brush", "Full Haircut", "Nail Trim", "Teeth Brushing",
  "De-shedding", "Ear Cleaning", "Sanitary Trim", "Flea Treatment",
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultDate?: string;
}

export default function GroomingAppointmentDialog({ open, onOpenChange, defaultDate }: Props) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const { data: groomers = [] } = useGroomers({ activeOnly: true });

  const [petId, setPetId] = useState<string>("");
  const [petPickerOpen, setPetPickerOpen] = useState(false);
  const [groomerId, setGroomerId] = useState<string>("");
  const [date, setDate] = useState<string>(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState<string>("09:00");
  const [duration, setDuration] = useState<string>("60");
  const [services, setServices] = useState<string[]>([]);
  const [price, setPrice] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setPetId(""); setGroomerId("");
    setDate(defaultDate ?? new Date().toISOString().slice(0, 10));
    setStartTime("09:00"); setDuration("60");
    setServices([]); setPrice(""); setNotes("");
  }, [open, defaultDate]);

  const { data: pets = [] } = useQuery({
    queryKey: ["grooming-pet-picker", orgId],
    enabled: !!orgId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pets")
        .select("id, name, pet_owners(owner_id, owners(id, first_name, last_name))")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("name")
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const selectedPet = useMemo(() => pets.find((p: any) => p.id === petId), [pets, petId]);
  const ownerInfo = useMemo(() => {
    if (!selectedPet) return null;
    const link = (selectedPet as any).pet_owners?.[0];
    return link?.owners ?? null;
  }, [selectedPet]);

  const selectedGroomer = useMemo(() => groomers.find((g) => g.id === groomerId), [groomers, groomerId]);

  // Soft warnings
  const warnings: string[] = [];
  if (selectedGroomer && date) {
    const dayName = DAY_NAMES[new Date(date + "T00:00:00").getDay()];
    if (!selectedGroomer.working_days.includes(dayName)) {
      warnings.push(`${selectedGroomer.display_name} doesn't normally work on ${dayName}.`);
    }
  }

  const { data: dayCount = 0 } = useQuery({
    queryKey: ["grooming-day-count", orgId, groomerId, date],
    enabled: !!orgId && !!groomerId && !!date && open,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("grooming_appointments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId!)
        .eq("groomer_id", groomerId)
        .eq("appointment_date", date)
        .neq("status", "cancelled");
      if (error) throw error;
      return count ?? 0;
    },
  });

  if (selectedGroomer && dayCount >= selectedGroomer.max_appointments_per_day) {
    warnings.push(`${selectedGroomer.display_name} is at their daily max (${dayCount}/${selectedGroomer.max_appointments_per_day}).`);
  }

  const toggleService = (s: string) => {
    setServices((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No org");
      if (!petId) throw new Error("Pet is required");
      if (!ownerInfo) throw new Error("Selected pet has no owner on file");
      if (!groomerId) throw new Error("Groomer is required");
      if (services.length === 0) throw new Error("Select at least one service");
      const priceCents = Math.round(parseFloat(price || "0") * 100);
      const { error } = await supabase.from("grooming_appointments").insert({
        organization_id: orgId,
        pet_id: petId,
        owner_id: ownerInfo.id,
        groomer_id: groomerId,
        appointment_date: date,
        start_time: startTime,
        estimated_duration_minutes: parseInt(duration, 10) || 60,
        services_requested: services,
        price_cents: priceCents,
        notes: notes.trim() || null,
        status: "scheduled",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Appointment scheduled");
      qc.invalidateQueries({ queryKey: ["grooming-appointments"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to schedule"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">New Grooming Appointment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Pet *</Label>
              <Popover open={petPickerOpen} onOpenChange={setPetPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                    {selectedPet ? (selectedPet as any).name : "Select pet..."}
                    <ChevronsUpDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0 pointer-events-auto" align="start">
                  <Command>
                    <CommandInput placeholder="Search pets..." />
                    <CommandList>
                      <CommandEmpty>No pets found.</CommandEmpty>
                      <CommandGroup>
                        {pets.map((p: any) => {
                          const o = p.pet_owners?.[0]?.owners;
                          return (
                            <CommandItem key={p.id} value={`${p.name} ${o?.first_name ?? ""} ${o?.last_name ?? ""}`}
                              onSelect={() => { setPetId(p.id); setPetPickerOpen(false); }}>
                              <Check className={cn("h-4 w-4", petId === p.id ? "opacity-100" : "opacity-0")} />
                              <div className="flex flex-col">
                                <span>{p.name}</span>
                                {o && <span className="text-xs text-text-tertiary">{o.first_name} {o.last_name}</span>}
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {ownerInfo && (
                <div className="mt-1.5 text-xs text-text-secondary">Owner: {ownerInfo.first_name} {ownerInfo.last_name}</div>
              )}
            </div>
            <div>
              <Label>Groomer *</Label>
              <Select value={groomerId} onValueChange={setGroomerId}>
                <SelectTrigger><SelectValue placeholder="Select groomer..." /></SelectTrigger>
                <SelectContent>
                  {groomers.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Date *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Start Time *</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label>Duration (min)</Label>
              <Input type="number" min={15} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning-light px-3 py-2 text-xs text-warning flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">{warnings.map((w, i) => <div key={i}>{w}</div>)}</div>
            </div>
          )}

          <div>
            <Label>Services Requested *</Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {SERVICE_OPTIONS.map((s) => (
                <label key={s} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm cursor-pointer hover:bg-accent">
                  <Checkbox checked={services.includes(s)} onCheckedChange={() => toggleService(s)} />
                  <span>{s}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Price ($)</Label>
              <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              placeholder="Special instructions, coat condition, behavioral notes..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving..." : "Schedule Appointment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
