import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  INCIDENT_ROLES,
  SEVERITY_BADGE,
  type IncidentRole,
  type IncidentSeverity,
  type IncidentType,
} from "@/lib/incidents";
import { cn } from "@/lib/utils";

type SelectedPet = { id: string; name: string; role: IncidentRole; injury: string };

export default function IncidentForm() {
  const { id: editId } = useParams();
  const isEdit = !!editId;
  const [params] = useSearchParams();
  const prefilledReservation = params.get("reservation");
  const prefilledPetIds = (params.get("pets") ?? "").split(",").filter(Boolean);

  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, membership } = useAuth();

  const [incidentType, setIncidentType] = useState<IncidentType>("behavioral");
  const [severity, setSeverity] = useState<IncidentSeverity>("minor");
  const [incidentAt, setIncidentAt] = useState<string>(formatLocalDateTimeInput(new Date()));
  const [locationId, setLocationId] = useState<string>("");
  const [reservationId, setReservationId] = useState<string>(prefilledReservation ?? "");
  const [description, setDescription] = useState("");
  const [actionTaken, setActionTaken] = useState("");

  const [selectedPets, setSelectedPets] = useState<SelectedPet[]>([]);
  const [petPickerOpen, setPetPickerOpen] = useState(false);

  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [ownerNotified, setOwnerNotified] = useState(false);
  const [ownerVisible, setOwnerVisible] = useState(false);

  const [saving, setSaving] = useState(false);

  // Locations
  const { data: locations } = useQuery({
    queryKey: ["locations-min", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("organization_id", membership!.organization_id)
        .eq("active", true)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Recent reservations (for the reservation dropdown)
  const { data: recentReservations } = useQuery({
    queryKey: ["recent-reservations", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select("id, start_at, services(name), owners:primary_owner_id(first_name, last_name)")
        .eq("organization_id", membership!.organization_id)
        .is("deleted_at", null)
        .order("start_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Pet typeahead
  const { data: pets } = useQuery({
    queryKey: ["pets-min", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pets")
        .select("id, name, species, photo_url")
        .eq("organization_id", membership!.organization_id)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Existing incident (edit mode)
  const { data: existing } = useQuery({
    queryKey: ["incident-edit", editId],
    enabled: isEdit,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("incidents")
        .select("*, incident_pets(id, pet_id, role, injury_description, pets(id, name))")
        .eq("id", editId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (existing) {
      setIncidentType(existing.incident_type as IncidentType);
      setSeverity(existing.severity as IncidentSeverity);
      setIncidentAt(formatLocalDateTimeInput(new Date(existing.incident_at)));
      setLocationId(existing.location_id ?? "");
      setReservationId(existing.reservation_id ?? "");
      setDescription(existing.description ?? "");
      setActionTaken(existing.action_taken ?? "");
      setFollowUpRequired(existing.follow_up_required ?? false);
      setFollowUpNotes(existing.follow_up_notes ?? "");
      setOwnerNotified(existing.owner_notified ?? false);
      setOwnerVisible(existing.owner_visible ?? false);
      setSelectedPets(
        ((existing as any).incident_pets ?? []).map((p: any) => ({
          id: p.pet_id,
          name: p.pets?.name ?? "Pet",
          role: p.role,
          injury: p.injury_description ?? "",
        })),
      );
    }
  }, [existing]);

  // Pre-fill pets from URL query param
  useEffect(() => {
    if (!isEdit && prefilledPetIds.length && pets && selectedPets.length === 0) {
      const sel = pets
        .filter((p: any) => prefilledPetIds.includes(p.id))
        .map((p: any) => ({ id: p.id, name: p.name, role: "involved" as IncidentRole, injury: "" }));
      if (sel.length) setSelectedPets(sel);
    }
  }, [pets, prefilledPetIds, isEdit, selectedPets.length]);

  // Default location from first available
  useEffect(() => {
    if (!locationId && locations && locations.length > 0 && !isEdit) {
      setLocationId(locations[0].id);
    }
  }, [locations, locationId, isEdit]);

  const availablePets = useMemo(() => {
    const ids = new Set(selectedPets.map((p) => p.id));
    return (pets ?? []).filter((p: any) => !ids.has(p.id));
  }, [pets, selectedPets]);

  const addPet = (p: any) => {
    setSelectedPets((prev) => [...prev, { id: p.id, name: p.name, role: "involved", injury: "" }]);
    setPetPickerOpen(false);
  };

  const removePet = (id: string) => {
    setSelectedPets((prev) => prev.filter((p) => p.id !== id));
  };

  const updatePet = (id: string, patch: Partial<SelectedPet>) => {
    setSelectedPets((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const submit = async () => {
    if (!description.trim()) {
      toast.error("Description is required");
      return;
    }
    if (selectedPets.length === 0) {
      toast.error("Add at least one pet involved");
      return;
    }
    if (!membership?.organization_id) return;

    setSaving(true);
    try {
      const incidentRow = {
        organization_id: membership.organization_id,
        location_id: locationId || null,
        reservation_id: reservationId || null,
        incident_type: incidentType,
        severity,
        description: description.trim(),
        action_taken: actionTaken.trim() || null,
        follow_up_required: followUpRequired,
        follow_up_notes: followUpRequired ? followUpNotes.trim() || null : null,
        owner_notified: ownerNotified,
        owner_notified_at: ownerNotified ? new Date().toISOString() : null,
        owner_visible: ownerVisible,
        reported_by: user?.id ?? null,
        incident_at: new Date(incidentAt).toISOString(),
      };

      let incidentId = editId;
      if (isEdit) {
        const { error } = await supabase.from("incidents").update(incidentRow).eq("id", editId!);
        if (error) throw error;
        // Replace pets: simplest correct approach
        await supabase.from("incident_pets").delete().eq("incident_id", editId!);
      } else {
        const { data, error } = await supabase
          .from("incidents")
          .insert(incidentRow)
          .select("id")
          .single();
        if (error) throw error;
        incidentId = data.id;
      }

      const petRows = selectedPets.map((p) => ({
        organization_id: membership.organization_id,
        incident_id: incidentId!,
        pet_id: p.id,
        role: p.role,
        injury_description: p.injury.trim() || null,
      }));
      const { error: petErr } = await supabase.from("incident_pets").insert(petRows);
      if (petErr) throw petErr;

      toast.success(isEdit ? "Incident updated" : "Incident report filed");
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["incident", incidentId] });
      navigate(`/incidents/${incidentId}`);
    } catch (e: any) {
      toast.error(e.message ?? "Could not save incident");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortalLayout>
      <div className="px-8 py-6 max-w-4xl">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="mb-3 -ml-2">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        <PageHeader title={isEdit ? "Edit incident" : "File incident report"} />

        <div className="space-y-6">
          {/* Section 1 */}
          <Section title="What happened">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Incident type</Label>
                <Select value={incidentType} onValueChange={(v) => setIncidentType(v as IncidentType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INCIDENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.staff}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Severity</Label>
                <div className="flex gap-2">
                  {INCIDENT_SEVERITIES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setSeverity(s.value)}
                      className={cn(
                        "flex-1 rounded-md border px-3 py-2 text-xs font-semibold transition-all",
                        severity === s.value
                          ? cn(SEVERITY_BADGE[s.value], "border-current")
                          : "border-border bg-background text-text-secondary hover:border-primary/40",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="when">Date & time</Label>
                <Input
                  id="when"
                  type="datetime-local"
                  value={incidentAt}
                  onChange={(e) => setIncidentAt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {(locations ?? []).map((l: any) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Linked reservation (optional)</Label>
                <Select value={reservationId || "none"} onValueChange={(v) => setReservationId(v === "none" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="No linked reservation" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No linked reservation</SelectItem>
                    {(recentReservations ?? []).map((r: any) => (
                      <SelectItem key={r.id} value={r.id}>
                        {format(new Date(r.start_at), "MMM d")} · {r.services?.name ?? "Reservation"} ·{" "}
                        {r.owners?.first_name ?? ""} {r.owners?.last_name ?? ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="desc">Description</Label>
                <Textarea
                  id="desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Describe what happened in detail"
                  required
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="action">Action taken</Label>
                <Textarea
                  id="action"
                  value={actionTaken}
                  onChange={(e) => setActionTaken(e.target.value)}
                  rows={3}
                  placeholder="What did staff do in response?"
                />
              </div>
            </div>
          </Section>

          {/* Section 2 */}
          <Section title="Pets involved">
            <div className="space-y-3">
              {selectedPets.length === 0 && (
                <p className="text-sm text-text-secondary">Add at least one pet involved in the incident.</p>
              )}
              {selectedPets.map((p) => (
                <div key={p.id} className="rounded-lg border border-border bg-background p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-foreground">{p.name}</div>
                    <button
                      type="button"
                      onClick={() => removePet(p.id)}
                      className="text-xs text-destructive hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Role</Label>
                      <Select value={p.role} onValueChange={(v) => updatePet(p.id, { role: v as IncidentRole })}>
                        <SelectTrigger className="bg-surface">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INCIDENT_ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Injury description (optional)</Label>
                      <Input
                        value={p.injury}
                        onChange={(e) => updatePet(p.id, { injury: e.target.value })}
                        className="bg-surface"
                        placeholder="e.g. minor scratch on left ear"
                      />
                    </div>
                  </div>
                </div>
              ))}

              <Popover open={petPickerOpen} onOpenChange={setPetPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" disabled={availablePets.length === 0}>
                    <Plus className="h-4 w-4" /> Add pet
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search pets…" />
                    <CommandList>
                      <CommandEmpty>No pets found.</CommandEmpty>
                      <CommandGroup>
                        {availablePets.map((p: any) => (
                          <CommandItem key={p.id} value={p.name} onSelect={() => addPet(p)}>
                            {p.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </Section>

          {/* Section 3 */}
          <Section title="Follow-up & owner communication">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="fur">Follow-up required</Label>
                  <p className="text-xs text-text-secondary">Flag for management review</p>
                </div>
                <Switch id="fur" checked={followUpRequired} onCheckedChange={setFollowUpRequired} />
              </div>
              {followUpRequired && (
                <Textarea
                  value={followUpNotes}
                  onChange={(e) => setFollowUpNotes(e.target.value)}
                  rows={3}
                  placeholder="Follow-up notes"
                />
              )}
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="notif">Notify owner(s)</Label>
                  <p className="text-xs text-text-secondary">
                    Records that the owner has been informed (out-of-band)
                  </p>
                </div>
                <Switch id="notif" checked={ownerNotified} onCheckedChange={setOwnerNotified} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="vis">Show in owner portal</Label>
                  <p className="text-xs text-text-secondary">
                    Make this incident visible to the pet's owner
                  </p>
                </div>
                <Switch id="vis" checked={ownerVisible} onCheckedChange={setOwnerVisible} />
              </div>
            </div>
          </Section>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "File Incident Report"}
            </Button>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
      <div className="font-display text-base mb-4 text-foreground">{title}</div>
      {children}
    </div>
  );
}

function formatLocalDateTimeInput(d: Date): string {
  // yyyy-MM-ddTHH:mm in local time
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
