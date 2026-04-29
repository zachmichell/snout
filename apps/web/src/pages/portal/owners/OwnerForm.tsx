import { useEffect, useState } from "react";
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
import { logActivity } from "@/lib/activity";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type CommPref = Database["public"]["Enums"]["communication_pref"];

type FormState = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  street_address: string;
  city: string;
  state_province: string;
  postal_code: string;
  communication_preference: CommPref;
  notes: string;
};

const empty: FormState = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  street_address: "",
  city: "",
  state_province: "",
  postal_code: "",
  communication_preference: "email",
  notes: "",
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
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  span?: 1 | 2;
}) {
  return (
    <div className={span === 2 ? "md:col-span-2" : ""}>
      <label className="mb-1.5 block text-xs font-semibold text-text-secondary">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

export default function OwnerForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { membership } = useAuth();
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);

  const { data: existing } = useQuery({
    queryKey: ["owner", id],
    enabled: isEdit,
    queryFn: async () => {
      const { data, error } = await supabase.from("owners").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (existing) {
      setForm({
        first_name: existing.first_name ?? "",
        last_name: existing.last_name ?? "",
        email: existing.email ?? "",
        phone: existing.phone ?? "",
        street_address: existing.street_address ?? "",
        city: existing.city ?? "",
        state_province: existing.state_province ?? "",
        postal_code: existing.postal_code ?? "",
        communication_preference: existing.communication_preference,
        notes: existing.notes ?? "",
      });
    }
  }, [existing]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const e: typeof errors = {};
    if (!form.first_name.trim()) e.first_name = "Required";
    if (!form.last_name.trim()) e.last_name = "Required";
    if (!form.email.trim()) e.email = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate() || !membership) return;
    setSaving(true);

    const payload = {
      ...form,
      email: form.email || null,
      phone: form.phone || null,
      street_address: form.street_address || null,
      city: form.city || null,
      state_province: form.state_province || null,
      postal_code: form.postal_code || null,
      notes: form.notes || null,
      organization_id: membership.organization_id,
    };

    if (isEdit) {
      const { error } = await supabase.from("owners").update(payload).eq("id", id!);
      setSaving(false);
      if (error) return toast.error(error.message);
      await logActivity({
        organization_id: membership.organization_id,
        action: "updated",
        entity_type: "owner",
        entity_id: id!,
        metadata: { name: `${form.first_name} ${form.last_name}`.trim() },
      });
      toast.success("Owner updated");
      navigate(`/owners/${id}`);
    } else {
      const { data, error } = await supabase.from("owners").insert(payload).select("id").single();
      setSaving(false);
      if (error) return toast.error(error.message);
      await logActivity({
        organization_id: membership.organization_id,
        action: "created",
        entity_type: "owner",
        entity_id: data.id,
        metadata: { name: `${form.first_name} ${form.last_name}`.trim() },
      });
      toast.success("Owner created");
      navigate(`/owners/${data.id}`);
    }
  };

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader title={isEdit ? "Edit Owner" : "New Owner"} />

        <form onSubmit={handleSubmit} className="mx-auto max-w-[720px]">
          <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
            <Section title="Personal Information">
              <Field label="First Name" required error={errors.first_name}>
                <Input value={form.first_name} onChange={(e) => update("first_name", e.target.value)} />
              </Field>
              <Field label="Last Name" required error={errors.last_name}>
                <Input value={form.last_name} onChange={(e) => update("last_name", e.target.value)} />
              </Field>
              <Field label="Email" required error={errors.email}>
                <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} />
              </Field>
            </Section>

            <Section title="Address">
              <Field label="Street Address" span={2}>
                <Input value={form.street_address} onChange={(e) => update("street_address", e.target.value)} />
              </Field>
              <Field label="City">
                <Input value={form.city} onChange={(e) => update("city", e.target.value)} />
              </Field>
              <Field label="Province / State">
                <Input value={form.state_province} onChange={(e) => update("state_province", e.target.value)} />
              </Field>
              <Field label="Postal Code">
                <Input value={form.postal_code} onChange={(e) => update("postal_code", e.target.value)} />
              </Field>
            </Section>

            <Section title="Preferences">
              <Field label="Preferred Communication">
                <Select
                  value={form.communication_preference}
                  onValueChange={(v) => update("communication_preference", v as CommPref)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </Section>

            <Section title="Notes">
              <Field label="Internal notes (not visible to owner)" span={2}>
                <Textarea rows={4} value={form.notes} onChange={(e) => update("notes", e.target.value)} />
              </Field>
            </Section>
          </div>

          <div className="mt-5 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save Owner"}
            </Button>
          </div>
        </form>
      </div>
    </PortalLayout>
  );
}
