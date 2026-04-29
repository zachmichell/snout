import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  computeEndFromStart,
  formatCentsShort,
  formatDurationType,
  toDatetimeLocalValue,
} from "@/lib/money";

export default function ReservationEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { membership } = useAuth();
  const [serviceId, setServiceId] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { data: existing } = useQuery({
    queryKey: ["reservation-edit", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("reservations").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: services } = useQuery({
    queryKey: ["active-services-edit", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, base_price_cents, duration_type, location_id, locations(name)")
        .eq("organization_id", membership!.organization_id)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (existing) {
      setServiceId(existing.service_id ?? "");
      setStartAt(toDatetimeLocalValue(existing.start_at));
      setEndAt(toDatetimeLocalValue(existing.end_at));
      setNotes(existing.notes ?? "");
    }
  }, [existing]);

  const selectedService = useMemo(
    () => services?.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  );

  const handleServiceChange = (newId: string) => {
    setServiceId(newId);
    const svc = services?.find((s) => s.id === newId);
    if (svc && startAt) setEndAt(computeEndFromStart(startAt, svc.duration_type));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!serviceId) e.service = "Required";
    if (!startAt) e.startAt = "Required";
    if (!endAt) e.endAt = "Required";
    if (startAt && endAt && new Date(endAt) <= new Date(startAt)) e.endAt = "Must be after start";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate() || !existing || !selectedService) return;
    setSaving(true);
    const { error } = await supabase
      .from("reservations")
      .update({
        service_id: serviceId,
        location_id: selectedService.location_id,
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(endAt).toISOString(),
        notes: notes || null,
      })
      .eq("id", existing.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Reservation updated");
    navigate(`/reservations/${existing.id}`);
  };

  if (!existing) {
    return (
      <PortalLayout>
        <div className="p-8 text-sm text-text-secondary">Loading…</div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader title="Edit Reservation" />
        <form onSubmit={handleSubmit} className="mx-auto max-w-[720px]">
          <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
            <div className="space-y-5">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-text-secondary">
                  Service <span className="text-destructive">*</span>
                </label>
                <Select value={serviceId} onValueChange={handleServiceChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(services ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} — {formatDurationType(s.duration_type)} · {formatCentsShort(s.base_price_cents)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.service && <p className="mt-1 text-xs text-destructive">{errors.service}</p>}
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-text-secondary">
                    Start <span className="text-destructive">*</span>
                  </label>
                  <Input
                    type="datetime-local"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    className="bg-background"
                  />
                  {errors.startAt && <p className="mt-1 text-xs text-destructive">{errors.startAt}</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-text-secondary">
                    End <span className="text-destructive">*</span>
                  </label>
                  <Input
                    type="datetime-local"
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                    className="bg-background"
                  />
                  {errors.endAt && <p className="mt-1 text-xs text-destructive">{errors.endAt}</p>}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-text-secondary">Notes</label>
                <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate(`/reservations/${existing.id}`)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </form>
      </div>
    </PortalLayout>
  );
}
