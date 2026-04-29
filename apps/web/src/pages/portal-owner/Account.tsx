import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function OwnerAccount() {
  const { profile, membership, refresh } = useAuth();
  const { data: owner, refetch: refetchOwner } = useOwnerRecord();
  const qc = useQueryClient();

  // Profile form
  const [profileForm, setProfileForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
  });
  const [commPref, setCommPref] = useState<"email" | "sms" | "both">("email");

  // Address form
  const [addr, setAddr] = useState({
    street_address: "",
    city: "",
    state_province: "",
    postal_code: "",
  });

  useEffect(() => {
    if (profile) {
      setProfileForm({
        first_name: profile.first_name ?? "",
        last_name: profile.last_name ?? "",
        phone: profile.phone ?? "",
      });
    }
  }, [profile]);

  useEffect(() => {
    if (owner) {
      setCommPref((owner.communication_preference as any) ?? "email");
      setAddr({
        street_address: owner.street_address ?? "",
        city: owner.city ?? "",
        state_province: owner.state_province ?? "",
        postal_code: owner.postal_code ?? "",
      });
    }
  }, [owner]);

  const { data: org } = useQuery({
    queryKey: ["owner-org-name", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", membership!.organization_id)
        .maybeSingle();
      return data;
    },
  });

  const saveProfile = useMutation({
    mutationFn: async () => {
      // Update profile
      const { error: pe } = await supabase
        .from("profiles")
        .update({
          first_name: profileForm.first_name || null,
          last_name: profileForm.last_name || null,
          phone: profileForm.phone || null,
        })
        .eq("id", profile!.id);
      if (pe) throw pe;
      // Update owner comm pref
      if (owner) {
        const { error: oe } = await supabase
          .from("owners")
          .update({
            first_name: profileForm.first_name || owner.first_name,
            last_name: profileForm.last_name || owner.last_name,
            phone: profileForm.phone || null,
            communication_preference: commPref,
          })
          .eq("id", owner.id);
        if (oe) throw oe;
      }
    },
    onSuccess: async () => {
      toast.success("Profile updated");
      await refresh();
      await refetchOwner();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update profile"),
  });

  const saveAddress = useMutation({
    mutationFn: async () => {
      if (!owner) throw new Error("Owner profile not found");
      const { error } = await supabase
        .from("owners")
        .update({
          street_address: addr.street_address || null,
          city: addr.city || null,
          state_province: addr.state_province || null,
          postal_code: addr.postal_code || null,
        })
        .eq("id", owner.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Address updated");
      await refetchOwner();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update address"),
  });

  // Emergency contacts
  const { data: contacts } = useQuery({
    queryKey: ["owner-emergency-contacts", owner?.id],
    enabled: !!owner?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emergency_contacts")
        .select("*")
        .eq("owner_id", owner!.id)
        .is("deleted_at", null)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [contactDialog, setContactDialog] = useState<{
    open: boolean;
    editing: any | null;
  }>({ open: false, editing: null });
  const [contactForm, setContactForm] = useState({
    name: "",
    phone: "",
    relationship: "",
  });

  useEffect(() => {
    if (contactDialog.open) {
      setContactForm({
        name: contactDialog.editing?.name ?? "",
        phone: contactDialog.editing?.phone ?? "",
        relationship: contactDialog.editing?.relationship ?? "",
      });
    }
  }, [contactDialog]);

  const saveContact = useMutation({
    mutationFn: async () => {
      if (!owner) throw new Error("Owner not found");
      if (contactDialog.editing) {
        const { error } = await supabase
          .from("emergency_contacts")
          .update({
            name: contactForm.name,
            phone: contactForm.phone,
            relationship: contactForm.relationship || null,
          })
          .eq("id", contactDialog.editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("emergency_contacts").insert({
          owner_id: owner.id,
          organization_id: owner.organization_id,
          name: contactForm.name,
          phone: contactForm.phone,
          relationship: contactForm.relationship || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Contact saved");
      setContactDialog({ open: false, editing: null });
      qc.invalidateQueries({ queryKey: ["owner-emergency-contacts", owner?.id] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save contact"),
  });

  const deleteContact = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("emergency_contacts")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contact removed");
      qc.invalidateQueries({ queryKey: ["owner-emergency-contacts", owner?.id] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to delete contact"),
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">Account Settings</h1>
        <p className="mt-2 text-muted-foreground">Manage your profile and contact information</p>
      </div>

      {/* Profile */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-foreground">Profile</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            <Input
              name="given-name"
              autoComplete="given-name"
              autoCapitalize="words"
              value={profileForm.first_name}
              onChange={(e) => setProfileForm({ ...profileForm, first_name: e.target.value })}
            />
          </Field>
          <Field label="Last name">
            <Input
              name="family-name"
              autoComplete="family-name"
              autoCapitalize="words"
              value={profileForm.last_name}
              onChange={(e) => setProfileForm({ ...profileForm, last_name: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <Input
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="off"
              spellCheck={false}
              value={profile?.email ?? ""}
              readOnly
              className="bg-muted/50"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Contact {org?.name ?? "your provider"} to update your email
            </p>
          </Field>
          <Field label="Phone">
            <Input
              name="tel"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={profileForm.phone}
              onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
            />
          </Field>
          <Field label="Preferred communication">
            <Select value={commPref} onValueChange={(v: any) => setCommPref(v)}>
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
        </div>
        <div className="mt-6 flex justify-end">
          <Button onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>
            {saveProfile.isPending ? "Saving…" : "Save Profile"}
          </Button>
        </div>
      </section>

      {/* Address */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-foreground">Address</h2>
        {!owner ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Address can be added once your account setup is complete.
          </p>
        ) : (
          <>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Street address" className="sm:col-span-2">
                <Input
                  name="street-address"
                  autoComplete="street-address"
                  autoCapitalize="words"
                  value={addr.street_address}
                  onChange={(e) => setAddr({ ...addr, street_address: e.target.value })}
                />
              </Field>
              <Field label="City">
                <Input
                  name="address-level2"
                  autoComplete="address-level2"
                  autoCapitalize="words"
                  value={addr.city}
                  onChange={(e) => setAddr({ ...addr, city: e.target.value })}
                />
              </Field>
              <Field label="State / Province">
                <Input
                  name="address-level1"
                  autoComplete="address-level1"
                  autoCapitalize="words"
                  value={addr.state_province}
                  onChange={(e) => setAddr({ ...addr, state_province: e.target.value })}
                />
              </Field>
              <Field label="Postal code">
                <Input
                  name="postal-code"
                  autoComplete="postal-code"
                  autoCapitalize="characters"
                  value={addr.postal_code}
                  onChange={(e) => setAddr({ ...addr, postal_code: e.target.value })}
                />
              </Field>
            </div>
            <div className="mt-6 flex justify-end">
              <Button onClick={() => saveAddress.mutate()} disabled={saveAddress.isPending}>
                {saveAddress.isPending ? "Saving…" : "Save Address"}
              </Button>
            </div>
          </>
        )}
      </section>

      {/* Emergency contacts */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-foreground">Emergency Contacts</h2>
          <Button
            size="sm"
            onClick={() => setContactDialog({ open: true, editing: null })}
            disabled={!owner}
          >
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </div>
        {!owner ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Emergency contacts can be added once your account setup is complete.
          </p>
        ) : contacts && contacts.length > 0 ? (
          <ul className="mt-5 divide-y divide-border-subtle">
            {contacts.map((c: any) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{c.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {c.phone}
                    {c.relationship && ` · ${c.relationship}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setContactDialog({ open: true, editing: c })}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteContact.mutate(c.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">No emergency contacts added yet.</p>
        )}
      </section>

      <Dialog
        open={contactDialog.open}
        onOpenChange={(open) => setContactDialog({ open, editing: open ? contactDialog.editing : null })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {contactDialog.editing ? "Edit contact" : "Add emergency contact"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Name">
              <Input
                value={contactForm.name}
                onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <Input
                value={contactForm.phone}
                onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
              />
            </Field>
            <Field label="Relationship">
              <Input
                value={contactForm.relationship}
                placeholder="e.g., Spouse, Friend, Vet"
                onChange={(e) => setContactForm({ ...contactForm, relationship: e.target.value })}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setContactDialog({ open: false, editing: null })}
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveContact.mutate()}
              disabled={saveContact.isPending || !contactForm.name || !contactForm.phone}
            >
              {saveContact.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-sm font-medium text-foreground">{label}</Label>
      {children}
    </div>
  );
}
