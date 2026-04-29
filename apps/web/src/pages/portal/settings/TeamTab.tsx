import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activity";
import { PERMISSIONS_BY_ROLE, type Role as PermRole, type Permission } from "@/lib/permissions";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Check, X } from "lucide-react";

type Role = "owner" | "admin" | "manager" | "staff" | "customer";
type AssignableRole = Exclude<Role, "owner" | "customer">;

type MemberRow = {
  id: string;
  profile_id: string;
  role: Role;
  active: boolean;
  profile: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
};

type Invite = {
  id: string;
  email: string;
  role: string;
  created_at: string;
  consumed_at: string | null;
};

const ROLE_VARIANT: Record<Role, string> = {
  owner: "bg-foreground text-background",
  admin: "bg-plum-light text-plum",
  manager: "bg-teal-light text-teal",
  staff: "bg-muted text-foreground",
  customer: "bg-muted text-muted-foreground",
};

export default function TeamTab() {
  const { membership, user } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["team", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data: mems, error } = await supabase
        .from("memberships")
        .select("id, profile_id, role, active")
        .eq("organization_id", orgId!);
      if (error) throw error;
      const ids = (mems ?? []).map((m) => m.profile_id);
      if (ids.length === 0) return [];
      const { data: profs, error: e2 } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", ids);
      if (e2) throw e2;
      const map = new Map(profs?.map((p) => [p.id, p]) ?? []);
      return (mems ?? []).map((m) => ({
        ...m,
        profile: map.get(m.profile_id) ?? null,
      })) as MemberRow[];
    },
  });

  const { data: invites = [] } = useQuery({
    queryKey: ["team-invites", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invitations")
        .select("id, email, role, created_at, consumed_at")
        .eq("organization_id", orgId!)
        .is("consumed_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Invite[];
    },
  });

  const ownerCount = members.filter((m) => m.role === "owner" && m.active).length;
  const isLastActiveOwner = (m: MemberRow) =>
    m.role === "owner" && m.active && ownerCount <= 1;

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("staff");

  const inviteMut = useMutation({
    mutationFn: async () => {
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Invalid email");
      const normalized = email.trim().toLowerCase();

      // If a profile already exists, add them directly so they get access immediately.
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email")
        .ilike("email", normalized)
        .maybeSingle();

      if (prof) {
        const { data: existing } = await supabase
          .from("memberships")
          .select("id")
          .eq("profile_id", prof.id)
          .eq("organization_id", orgId!)
          .maybeSingle();
        if (existing) throw new Error("Already a team member");

        const { error } = await supabase.from("memberships").insert({
          profile_id: prof.id,
          organization_id: orgId!,
          role,
          active: true,
        });
        if (error) throw error;
        await logActivity({
          organization_id: orgId!,
          action: "member_added",
          entity_type: "membership",
          entity_id: prof.id,
          metadata: { email: normalized, role },
        });
        return { kind: "added" as const, label: [prof.first_name, prof.last_name].filter(Boolean).join(" ") || normalized };
      }

      // Otherwise pre-create the invitation; it will auto-link on signup.
      const { data: dup } = await supabase
        .from("pending_invitations")
        .select("id")
        .eq("organization_id", orgId!)
        .ilike("email", normalized)
        .is("consumed_at", null)
        .maybeSingle();
      if (dup) throw new Error("An invite for this email is already pending");

      const { error } = await supabase.from("pending_invitations").insert({
        organization_id: orgId!,
        email: normalized,
        role,
        invited_by: user?.id ?? null,
      });
      if (error) throw error;
      await logActivity({
        organization_id: orgId!,
        action: "member_invited",
        entity_type: "invitation",
        metadata: { email: normalized, role },
      });
      return { kind: "invited" as const, label: normalized };
    },
    onSuccess: (r) => {
      if (r.kind === "added") toast.success(`${r.label} added to team`);
      else toast.success(`Invite sent to ${r.label}. They'll be added when they sign up.`);
      setOpen(false);
      setEmail("");
      qc.invalidateQueries({ queryKey: ["team", orgId] });
      qc.invalidateQueries({ queryKey: ["team-invites", orgId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to invite"),
  });

  const cancelInvite = useMutation({
    mutationFn: async (inv: Invite) => {
      const { error } = await supabase.from("pending_invitations").delete().eq("id", inv.id);
      if (error) throw error;
      await logActivity({
        organization_id: orgId!,
        action: "invitation_cancelled",
        entity_type: "invitation",
        entity_id: inv.id,
        metadata: { email: inv.email, role: inv.role },
      });
    },
    onSuccess: () => {
      toast.success("Invitation cancelled");
      qc.invalidateQueries({ queryKey: ["team-invites", orgId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const updateRole = useMutation({
    mutationFn: async ({ m, newRole }: { m: MemberRow; newRole: Role }) => {
      // Use the protected RPC — server enforces last-owner guard.
      const { error } = await supabase.rpc("update_member_role", {
        _membership_id: m.id,
        _new_role: newRole as any,
      });
      if (error) throw error;
      await logActivity({
        organization_id: orgId!,
        action: "member_role_changed",
        entity_type: "membership",
        entity_id: m.profile_id,
        metadata: { from: m.role, to: newRole },
      });
    },
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["team", orgId] });
    },
    onError: (e: any) => {
      const msg = String(e.message ?? "");
      if (msg.includes("last active owner")) {
        toast.error("Can't change this role — they're the last active owner. Promote someone else first.");
      } else {
        toast.error(msg || "Failed");
      }
    },
  });

  const setActive = useMutation({
    mutationFn: async ({ m, active }: { m: MemberRow; active: boolean }) => {
      const { error } = await supabase.rpc("set_member_active", {
        _membership_id: m.id,
        _active: active,
      });
      if (error) throw error;
      await logActivity({
        organization_id: orgId!,
        action: active ? "member_reactivated" : "member_deactivated",
        entity_type: "membership",
        entity_id: m.profile_id,
        metadata: { role: m.role },
      });
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.active ? "Member reactivated" : "Member deactivated");
      qc.invalidateQueries({ queryKey: ["team", orgId] });
    },
    onError: (e: any) => {
      const msg = String(e.message ?? "");
      if (msg.includes("last active owner")) {
        toast.error("Can't deactivate the last active owner. Promote another teammate first.");
      } else {
        toast.error(msg || "Failed");
      }
    },
  });

  return (
    <Tabs defaultValue="members" className="space-y-4">
      <TabsList>
        <TabsTrigger value="members">Members</TabsTrigger>
        <TabsTrigger value="invites">Pending invites {invites.length > 0 && <span className="ml-1 text-xs">({invites.length})</span>}</TabsTrigger>
        <TabsTrigger value="permissions">Role permissions</TabsTrigger>
      </TabsList>

      <TabsContent value="members" className="space-y-4">
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Invite Team Member
          </Button>
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">Loading…</TableCell>
                </TableRow>
              ) : members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No team members yet.</TableCell>
                </TableRow>
              ) : (
                members.map((m) => {
                  const isMe = m.profile_id === user?.id;
                  const fullName = [m.profile?.first_name, m.profile?.last_name].filter(Boolean).join(" ") || "—";
                  const lastOwner = isLastActiveOwner(m);
                  const roleSelectDisabled = isMe || lastOwner;
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        {fullName}
                        {isMe && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                        {lastOwner && <span className="ml-2 text-xs text-muted-foreground">(last owner)</span>}
                      </TableCell>
                      <TableCell className="text-sm">{m.profile?.email ?? "—"}</TableCell>
                      <TableCell>
                        {roleSelectDisabled ? (
                          <Badge className={ROLE_VARIANT[m.role]}>{m.role}</Badge>
                        ) : (
                          <Select
                            value={m.role}
                            onValueChange={(v) => updateRole.mutate({ m, newRole: v as Role })}
                          >
                            <SelectTrigger className="h-8 w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="owner">owner</SelectItem>
                              <SelectItem value="admin">admin</SelectItem>
                              <SelectItem value="manager">manager</SelectItem>
                              <SelectItem value="staff">staff</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.active ? "default" : "secondary"}>
                          {m.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {!isMe && m.active && !lastOwner && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (confirm(`Deactivate ${fullName}?`)) setActive.mutate({ m, active: false });
                            }}
                          >
                            Deactivate
                          </Button>
                        )}
                        {!isMe && !m.active && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActive.mutate({ m, active: true })}
                          >
                            Reactivate
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </TabsContent>

      <TabsContent value="invites">
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">No pending invitations.</TableCell>
                </TableRow>
              ) : (
                invites.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell><Badge variant="secondary">{inv.role}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => cancelInvite.mutate(inv)}>
                        Cancel
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </TabsContent>

      <TabsContent value="permissions">
        <RoleMatrix />
      </TabsContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Invite team member</DialogTitle>
            <DialogDescription>
              Enter their email. If they already have a Snout account they're added immediately;
              otherwise we'll save the invite and add them automatically when they sign up.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Email *</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="person@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AssignableRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">admin</SelectItem>
                  <SelectItem value="manager">manager</SelectItem>
                  <SelectItem value="staff">staff</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => inviteMut.mutate()} disabled={inviteMut.isPending}>
              {inviteMut.isPending ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}

const ROLES: PermRole[] = ["owner", "admin", "manager", "staff", "customer"];

const PERMISSION_GROUPS: Array<{ label: string; permissions: Permission[] }> = [
  { label: "Settings", permissions: ["settings.view", "settings.organization", "settings.locations", "settings.team", "settings.payments", "settings.billing", "settings.email", "settings.subscription"] },
  { label: "Operations", permissions: ["reservations.create", "reservations.edit", "reservations.cancel", "checkinout.perform", "carelogs.create", "reportcards.create", "reportcards.publish", "incidents.create", "incidents.edit", "messaging.send"] },
  { label: "Billing", permissions: ["invoices.view", "invoices.create", "invoices.edit", "invoices.send"] },
  { label: "Records", permissions: ["pets.create", "pets.edit", "owners.create", "owners.edit"] },
  { label: "Facility", permissions: ["services.manage", "playgroups.manage", "kennels.manage"] },
  { label: "Data", permissions: ["data.import", "data.export", "data.merge", "audit.view", "analytics.view"] },
];

function RoleMatrix() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">Role permissions</CardTitle>
        <p className="text-xs text-muted-foreground">
          Read-only summary of what each role can do. Per-user overrides aren't available in v1.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[280px]">Permission</TableHead>
              {ROLES.map((r) => (
                <TableHead key={r} className="text-center capitalize">{r}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {PERMISSION_GROUPS.map((group) => (
              <>
                <TableRow key={`${group.label}-h`} className="bg-muted/40">
                  <TableCell colSpan={ROLES.length + 1} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </TableCell>
                </TableRow>
                {group.permissions.map((p) => (
                  <TableRow key={p}>
                    <TableCell className="font-mono text-xs">{p}</TableCell>
                    {ROLES.map((r) => (
                      <TableCell key={r} className="text-center">
                        {PERMISSIONS_BY_ROLE[r].includes(p) ? (
                          <Check className="mx-auto h-4 w-4 text-success" />
                        ) : (
                          <X className="mx-auto h-3.5 w-3.5 text-muted-foreground/40" />
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
