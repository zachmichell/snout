import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOrgModules } from "@/hooks/useOrgModules";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { centsToDollarString, parseDollarsToCents } from "@/lib/money";

type ModuleEnum = Database["public"]["Enums"]["module_enum"];
type DurationEnum = Database["public"]["Enums"]["duration_type_enum"];

type FormState = {
  name: string;
  module: ModuleEnum | "";
  description: string;
  duration_type: DurationEnum | "";
  base_price_dollars: string;
  max_pets_per_booking: string;
  active: boolean;
  location_id: string;
};

const empty: FormState = {
  name: "",
  module: "",
  description: "",
  duration_type: "",
  base_price_dollars: "0.00",
  max_pets_per_booking: "",
  active: true,
  location_id: "",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border-subtle py-5 first:pt-0 last:border-b-0 last:pb-0">
      <div className="label-eyebrow mb-3">{title}</div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
  span = 1,
  hint,
}: {
  label: React.ReactNode;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  span?: 1 | 2;
  hint?: string;
}) {
  return (
    <div className={span === 2 ? "md:col-span-2" : ""}>
      <label className="mb-1.5 block text-xs font-semibold text-text-secondary">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-text-tertiary">{hint}</p>}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

export default function ServiceForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { membership } = useAuth();
  const { data: enabledModules } = useOrgModules();
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);

  const { data: locations } = useQuery({
    queryKey: ["locations-for-services", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("organization_id", membership!.organization_id)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: existing } = useQuery({
    queryKey: ["service", id],
    enabled: isEdit,
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name ?? "",
        module: (existing.module as ModuleEnum) ?? "",
        description: existing.description ?? "",
        duration_type: (existing.duration_type as DurationEnum) ?? "",
        base_price_dollars: centsToDollarString(existing.base_price_cents),
        max_pets_per_booking:
          (existing as any).max_pets_per_booking != null ? String((existing as any).max_pets_per_booking) : "",
        active: existing.active ?? true,
        location_id: existing.location_id ?? "",
      });
    }
  }, [existing]);

  // Default to first location if creating
  useEffect(() => {
    if (!isEdit && locations && locations.length > 0 && !form.location_id) {
      setForm((f) => ({ ...f, location_id: locations[0].id }));
    }
  }, [locations, isEdit, form.location_id]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const e: typeof errors = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.module) e.module = "Required";
    if (!form.duration_type) e.duration_type = "Required";
    if (!form.location_id) e.location_id = "Required";
    const cents = parseDollarsToCents(form.base_price_dollars);
    if (cents == null) e.base_price_dollars = "Enter a valid price";
    if (form.max_pets_per_booking) {
      const n = Number(form.max_pets_per_booking);
      if (!Number.isInteger(n) || n < 1) e.max_pets_per_booking = "Must be a whole number ≥ 1";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate() || !membership) return;
    setSaving(true);

    const payload: any = {
      name: form.name.trim(),
      module: form.module,
      description: form.description || null,
      duration_type: form.duration_type,
      base_price_cents: parseDollarsToCents(form.base_price_dollars) ?? 0,
      max_pets_per_booking: form.max_pets_per_booking ? Number(form.max_pets_per_booking) : null,
      active: form.active,
      location_id: form.location_id || null,
      organization_id: membership.organization_id,
    };

    if (isEdit) {
      const { error } = await supabase.from("services").update(payload).eq("id", id!);
      setSaving(false);
      if (error) return toast.error(error.message);
      toast.success("Service updated");
      navigate("/services");
    } else {
      const { error } = await supabase.from("services").insert(payload);
      setSaving(false);
      if (error) return toast.error(error.message);
      toast.success("Service created");
      navigate("/services");
    }
  };

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader title={isEdit ? "Edit Service" : "New Service"} />

        <form onSubmit={handleSubmit} className="mx-auto max-w-[720px]">
          <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
            <Section title="Service Details">
              <Field label="Name" required error={errors.name} span={2}>
                <Input value={form.name} onChange={(e) => update("name", e.target.value)} />
              </Field>
              <Field label="Module" required error={errors.module}>
                <Select value={form.module} onValueChange={(v) => update("module", v as ModuleEnum)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(!enabledModules || enabledModules.has("daycare")) && (
                      <SelectItem value="daycare">Daycare</SelectItem>
                    )}
                    {(!enabledModules || enabledModules.has("boarding")) && (
                      <SelectItem value="boarding">Boarding</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Duration Type" required error={errors.duration_type}>
                <Select
                  value={form.duration_type}
                  onValueChange={(v) => update("duration_type", v as DurationEnum)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="half_day">Half Day</SelectItem>
                    <SelectItem value="full_day">Full Day</SelectItem>
                    <SelectItem value="overnight">Overnight</SelectItem>
                    <SelectItem value="multi_night">Multi-Night</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Description" span={2} hint="Public-facing — visible in the owner portal">
                <Textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                />
              </Field>
            </Section>

            <Section title="Pricing">
              <Field label="Base Price" required error={errors.base_price_dollars}>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-tertiary">$</span>
                  <Input
                    inputMode="decimal"
                    value={form.base_price_dollars}
                    onChange={(e) => update("base_price_dollars", e.target.value)}
                    className="pl-7"
                    placeholder="0.00"
                  />
                </div>
              </Field>
              <Field
                label={
                  <span className="inline-flex items-center gap-1">
                    Max Pets Per Booking
                    <Tooltip>
                      <TooltipTrigger type="button" asChild>
                        <Info className="h-3.5 w-3.5 text-text-tertiary" />
                      </TooltipTrigger>
                      <TooltipContent>
                        For shared-run boarding where one family brings multiple pets
                      </TooltipContent>
                    </Tooltip>
                  </span>
                }
                error={errors.max_pets_per_booking}
              >
                <Input
                  inputMode="numeric"
                  value={form.max_pets_per_booking}
                  onChange={(e) => update("max_pets_per_booking", e.target.value)}
                  placeholder="—"
                />
              </Field>
            </Section>

            <Section title="Location & Status">
              <Field label="Location" required error={errors.location_id}>
                <Select value={form.location_id} onValueChange={(v) => update("location_id", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(locations ?? []).map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Active">
                <div className="flex h-10 items-center gap-3">
                  <Switch checked={form.active} onCheckedChange={(v) => update("active", v)} />
                  <span className="text-sm text-text-secondary">
                    {form.active ? "Available for booking" : "Hidden from new bookings"}
                  </span>
                </div>
              </Field>
            </Section>
          </div>

          <div className="mt-5 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate("/services")}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save Service"}
            </Button>
          </div>
        </form>
      </div>
    </PortalLayout>
  );
}
