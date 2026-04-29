import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Archive, Mail } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import StatusBadge, { commPrefTone, relationshipTone } from "@/components/portal/StatusBadge";
import PetOwnerLinkDialog from "@/components/portal/PetOwnerLinkDialog";
import PaymentMethodsSection from "@/components/portal/PaymentMethodsSection";
import { OwnerCreditsCard } from "@/components/portal/OwnerCreditsCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDate, speciesIcon } from "@/lib/format";
import { toast } from "sonner";
import { sendWaiverReminder } from "@/lib/email";
import { usePermissions } from "@/hooks/usePermissions";

export default function OwnerDetail() {
  const { can } = usePermissions();
  const canEdit = can("owners.edit");
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { membership } = useAuth();
  const [linkOpen, setLinkOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [unlinkId, setUnlinkId] = useState<string | null>(null);

  const { data: owner } = useQuery({
    queryKey: ["owner", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("owners").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: pets } = useQuery({
    queryKey: ["owner-pets", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_owners")
        .select("id, role, relationship, pet:pets(id, name, species, breed, deleted_at)")
        .eq("owner_id", id!);
      if (error) throw error;
      return (data ?? []).filter((r: any) => r.pet && !r.pet.deleted_at);
    },
  });

  const { data: contacts } = useQuery({
    queryKey: ["owner-contacts", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emergency_contacts")
        .select("*")
        .eq("owner_id", id!)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const archive = async () => {
    const { error } = await supabase
      .from("owners")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id!);
    if (error) return toast.error(error.message);
    toast.success("Owner archived");
    navigate("/owners");
  };

  const sendWaiverReminderEmail = async () => {
    if (!owner?.email) return toast.error("Owner has no email on file");
    if (!membership?.organization_id) return toast.error("Missing organization");
    // Find active waivers for this org and check which ones this owner has NOT signed
    const { data: waivers, error: wErr } = await supabase
      .from("waivers")
      .select("id, title")
      .eq("organization_id", membership.organization_id)
      .eq("active", true)
      .is("deleted_at", null);
    if (wErr) return toast.error(wErr.message);
    const { data: signed } = await supabase
      .from("waiver_signatures")
      .select("waiver_id")
      .eq("owner_id", id!);
    const signedIds = new Set((signed ?? []).map((s) => s.waiver_id));
    const unsigned = (waivers ?? []).filter((w) => !signedIds.has(w.id));
    if (unsigned.length === 0) return toast.info("All waivers are already signed");
    const res = await sendWaiverReminder({
      organization_id: membership.organization_id,
      to: owner.email,
      waiver_titles: unsigned.map((w) => w.title),
      owner_first_name: owner.first_name,
    });
    if ((res as any)?.skipped) return toast.info("Waiver reminders are disabled in Email settings");
    if (!res?.success) return toast.error(res?.error ?? "Could not send reminder");
    toast.success(`Reminder sent for ${unsigned.length} waiver(s)`);
  };

  const unlinkPet = async (linkId: string) => {
    const { error } = await supabase.from("pet_owners").delete().eq("id", linkId);
    if (error) return toast.error(error.message);
    toast.success("Pet unlinked");
    qc.invalidateQueries({ queryKey: ["owner-pets", id] });
    setUnlinkId(null);
  };

  if (!owner) {
    return (
      <PortalLayout>
        <div className="px-8 py-6 text-sm text-text-secondary">Loading…</div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title={`${owner.first_name} ${owner.last_name}`}
          description={
            <span className="flex flex-wrap items-center gap-3 text-text-secondary">
              {owner.email && <span>{owner.email}</span>}
              {owner.phone && <span>· {owner.phone}</span>}
              <StatusBadge tone={commPrefTone(owner.communication_preference)}>
                {owner.communication_preference}
              </StatusBadge>
            </span>
          }
          actions={
            <>
              <Button variant="outline" onClick={sendWaiverReminderEmail}>
                <Mail className="h-4 w-4" /> Send Waiver Reminder
              </Button>
              {canEdit && (
                <>
                  <Button variant="outline" onClick={() => navigate(`/owners/${id}/edit`)}>
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                  <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setArchiveOpen(true)}>
                    <Archive className="h-4 w-4" /> Archive
                  </Button>
                </>
              )}
            </>
          }
        />

        <Tabs defaultValue="details">
          <TabsList className="bg-transparent border-b border-border-subtle rounded-none h-auto p-0 w-full justify-start gap-6">
            {["details", "pets", "contacts", "payment"].map((v, i) => (
              <TabsTrigger
                key={v}
                value={v}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-1 pb-3"
              >
                {["Details", "Pets", "Emergency Contacts", "Payment Methods"][i]}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="details" className="mt-6 space-y-4">
            <OwnerCreditsCard owner={owner as any} />

            <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
              <div className="font-display text-base mb-3">Address</div>
              {owner.street_address || owner.city ? (
                <div className="text-sm text-text-secondary leading-6">
                  {owner.street_address && <div>{owner.street_address}</div>}
                  <div>
                    {[owner.city, owner.state_province, owner.postal_code].filter(Boolean).join(", ")}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-text-tertiary">No address on file.</div>
              )}
            </div>

            {owner.notes && (
              <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
                <div className="font-display text-base mb-2">Staff Notes</div>
                <p className="whitespace-pre-wrap text-sm text-text-secondary">{owner.notes}</p>
              </div>
            )}

            <div className="rounded-lg border border-border bg-surface p-5 shadow-card text-xs text-text-tertiary">
              Created {formatDate(owner.created_at)} · Updated {formatDate(owner.updated_at)}
            </div>
          </TabsContent>

          <TabsContent value="pets" className="mt-6">
            <div className="rounded-lg border border-border bg-surface shadow-card">
              <div className="flex items-center justify-between border-b border-border-subtle p-4">
                <div className="font-display text-base">Linked Pets</div>
                <Button size="sm" onClick={() => setLinkOpen(true)}>
                  <Plus className="h-4 w-4" /> Link Pet
                </Button>
              </div>
              {!pets || pets.length === 0 ? (
                <div className="p-8 text-center text-sm text-text-secondary">No pets linked yet.</div>
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {pets.map((row: any) => (
                    <li key={row.id} className="flex items-center justify-between gap-4 p-4">
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{speciesIcon(row.pet.species)}</span>
                        <div>
                          <Link to={`/pets/${row.pet.id}`} className="font-medium text-foreground hover:text-primary">
                            {row.pet.name}
                          </Link>
                          {row.pet.breed && <div className="text-xs text-text-secondary">{row.pet.breed}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge tone={row.role === "primary" ? "primary" : "muted"}>
                          {row.role === "primary" ? "Primary" : "Co-owner"}
                        </StatusBadge>
                        <Link to={`/pets/${row.pet.id}`} className="text-xs font-semibold text-primary hover:underline">
                          View
                        </Link>
                        <button
                          onClick={() => setUnlinkId(row.id)}
                          className="text-xs font-semibold text-destructive hover:underline"
                        >
                          Unlink
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="contacts" className="mt-6">
            <EmergencyContactsPanel
              ownerId={id!}
              orgId={membership?.organization_id ?? ""}
              contacts={contacts ?? []}
              onChange={() => qc.invalidateQueries({ queryKey: ["owner-contacts", id] })}
            />
          </TabsContent>

          <TabsContent value="payment" className="mt-6">
            <PaymentMethodsSection ownerId={id!} />
          </TabsContent>
        </Tabs>
      </div>

      <PetOwnerLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        mode="owner-to-pet"
        ownerId={id}
        contextName={`${owner.first_name} ${owner.last_name}`}
        excludeIds={(pets ?? []).map((p: any) => p.pet.id)}
        onLinked={() => qc.invalidateQueries({ queryKey: ["owner-pets", id] })}
      />

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive owner?</AlertDialogTitle>
            <AlertDialogDescription>
              This owner will be hidden from lists. You can restore them later via the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={archive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!unlinkId} onOpenChange={(o) => !o && setUnlinkId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink pet?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the relationship between this owner and the pet. Both records remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => unlinkId && unlinkPet(unlinkId)}>Unlink</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalLayout>
  );
}

function EmergencyContactsPanel({
  ownerId,
  orgId,
  contacts,
  onChange,
}: {
  ownerId: string;
  orgId: string;
  contacts: any[];
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setPhone("");
    setRelationship("");
    setAdding(false);
    setEditingId(null);
  };

  const startEdit = (c: any) => {
    setEditingId(c.id);
    setAdding(false);
    setName(c.name);
    setPhone(c.phone);
    setRelationship(c.relationship ?? "");
  };

  const save = async () => {
    if (!name.trim() || !phone.trim()) return toast.error("Name and phone required");
    const payload = {
      name: name.trim(),
      phone: phone.trim(),
      relationship: relationship.trim() || null,
      owner_id: ownerId,
      organization_id: orgId,
    };
    if (editingId) {
      const { error } = await supabase.from("emergency_contacts").update(payload).eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success("Contact updated");
    } else {
      const { error } = await supabase.from("emergency_contacts").insert(payload);
      if (error) return toast.error(error.message);
      toast.success("Contact added");
    }
    reset();
    onChange();
  };

  const remove = async (cid: string) => {
    const { error } = await supabase.from("emergency_contacts").delete().eq("id", cid);
    if (error) return toast.error(error.message);
    toast.success("Contact removed");
    setDeleteId(null);
    onChange();
  };

  return (
    <div className="rounded-lg border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-border-subtle p-4">
        <div className="font-display text-base">Emergency Contacts</div>
        {!adding && !editingId && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add Contact
          </Button>
        )}
      </div>

      {(adding || editingId) && (
        <div className="grid gap-3 border-b border-border-subtle p-4 md:grid-cols-3">
          <Input placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Phone *" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input
            placeholder="Relationship (e.g., Spouse)"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
          />
          <div className="md:col-span-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              Cancel
            </Button>
            <Button size="sm" onClick={save}>
              {editingId ? "Update" : "Add"}
            </Button>
          </div>
        </div>
      )}

      {contacts.length === 0 && !adding ? (
        <div className="p-8 text-center text-sm text-text-secondary">No emergency contacts yet.</div>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <div className="font-medium text-foreground">{c.name}</div>
                <div className="text-xs text-text-secondary">
                  {c.phone}
                  {c.relationship && ` · ${c.relationship}`}
                </div>
              </div>
              <div className="flex gap-3 text-xs font-semibold">
                <button onClick={() => startEdit(c)} className="text-primary hover:underline">
                  Edit
                </button>
                <button onClick={() => setDeleteId(c.id)} className="text-destructive hover:underline">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && remove(deleteId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
