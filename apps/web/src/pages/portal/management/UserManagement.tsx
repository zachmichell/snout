import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus, Users, Check, X } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/format";
import { PERMISSIONS_BY_ROLE, type Role, type Permission } from "@/lib/permissions";

type StaffRole = "owner" | "admin" | "manager" | "staff";
const ASSIGNABLE_ROLES: StaffRole[] = ["admin", "manager", "staff"];

const ROLE_BADGE: Record<StaffRole, string> = {
  owner: "bg-foreground text-background",
  admin: "bg-plum-light text-plum",
  manager: "bg-teal-light text-teal",
  staff: "bg-muted text-foreground",
};

type Member = {
  id: string;
  profile_id: string;
  role: StaffRole;
  active: boolean;
  created_at: string;
  profile: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
};

type Invitation = {
  id: string;
  email: string;
  role: string;
  created_at: string;
};

export default function UserManagement() {
  const { membership, user } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const [tab, setTab] = useState("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<StaffRole>("staff");

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["user-mgmt-members", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data: mems, error } = await supabase
        .from("memberships")
        .select("id, profile_id, role, active, created_at")
        .eq("organization_id", orgId!)
        .neq("role", "customer");
      if (error) throw error;
      const ids = (mems ?? []).map((m) => m.profile_id);
      if (ids.length === 0) return [] as Member[];
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", ids);
      const map = new Map((profs ?? []).map((p) => [p.id, p]));
      return (mems ?? []).map((m) => ({
        ...m,
        profile: map.get(m.profile_id) ?? null,
      })) as Member[];
    },
  });

  const { data: invitations = [] } = useQuery({
    queryKey: ["user-mgmt-invites", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invitations")
        .select("id, email, role, created_at")
        .eq("organization_id", orgId!)
        .is("consumed_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Invitation[];
    },
  });

  const invite = useMutation({
    mutationFn: async () => {
      const email = inviteEmail.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Invalid email");

      // If a profile already exists with this email, create membership directly
      const { data: prof } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .maybeSingle();

      if (prof) {
        const { data: existing } = await supabase
          .from("memberships")
          .select("id, active")
          .eq("profile_id", prof.id)
          .eq("organization_id", orgId!)
          .maybeSingle();
        if (existing) throw new Error("Already a member of this organization");
        const { error } = await supabase.from("memberships").insert({
          profile_id: prof.id,
          organization_id: orgId!,
          role: inviteRole,
          active: true,
        });
        if (error) throw error;
        return { mode: "linked" as const };
      }

      // Otherwise pre-create invitation
      const { error } = await supabase.from("pending_invitations").insert({
        organization_id: orgId!,
        email,
        role: inviteRole,
        invited_by: user?.id,
      });
      if (error) throw error;
      return { mode: "invited" as const };
    },
    onSuccess: (r) => {
      toast.success(
        r.mode === "linked" ? "User added to your team" : "Invitation saved — they'll join on signup",
      );
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("staff");
      qc.invalidateQueries({ queryKey: ["user-mgmt-members", orgId] });
      qc.invalidateQueries({ queryKey: ["user-mgmt-invites", orgId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: StaffRole }) => {
      const { error } = await supabase.rpc("update_member_role", {
        _membership_id: id,
        _new_role: role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["user-mgmt-members", orgId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update role"),
  });

  const setActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.rpc("set_member_active", {
        _membership_id: id,
        _active: active,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.active ? "User reactivated" : "User deactivated");
      qc.invalidateQueries({ queryKey: ["user-mgmt-members", orgId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const cancelInvite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pending_invitations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invitation cancelled");
      qc.invalidateQueries({ queryKey: ["user-mgmt-invites", orgId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="User Management"
          description="Manage team members, invitations, and roles"
          actions={
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" /> Invite User
            </Button>
          }
        />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="members">Team</TabsTrigger>
            <TabsTrigger value="invites">
              Pending Invites
              {invitations.length > 0 && (
                <Badge variant="outline" className="ml-2 h-5">
                  {invitations.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="permissions">Permissions</TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="mt-6">
            <div className="rounded-lg border border-border bg-surface shadow-card">
              {isLoading ? (
                <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
              ) : members.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={Users}
                    title="No team members yet"
                    description="Invite your first team member to get started."
                  />
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background text-left">
                      <th className="px-[18px] py-[14px] label-eyebrow">Name</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Email</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Role</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Status</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Joined</th>
                      <th className="px-[18px] py-[14px] label-eyebrow text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => {
                      const isMe = m.profile_id === user?.id;
                      const fullName =
                        [m.profile?.first_name, m.profile?.last_name].filter(Boolean).join(" ") || "—";
                      return (
                        <tr key={m.id} className="border-t border-border-subtle hover:bg-background">
                          <td className="px-[18px] py-[14px] font-medium text-foreground">
                            {fullName}
                            {isMe && (
                              <span className="ml-2 text-xs text-text-tertiary">(you)</span>
                            )}
                          </td>
                          <td className="px-[18px] py-[14px] text-text-secondary">
                            {m.profile?.email ?? "—"}
                          </td>
                          <td className="px-[18px] py-[14px]">
                            {m.role === "owner" || isMe ? (
                              <Badge className={ROLE_BADGE[m.role]}>{m.role}</Badge>
                            ) : (
                              <Select
                                value={m.role}
                                onValueChange={(v) =>
                                  updateRole.mutate({ id: m.id, role: v as StaffRole })
                                }
                              >
                                <SelectTrigger className="h-8 w-32">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ASSIGNABLE_ROLES.map((r) => (
                                    <SelectItem key={r} value={r}>
                                      {r}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </td>
                          <td className="px-[18px] py-[14px]">
                            <Badge
                              variant="outline"
                              className={
                                m.active ? "border-success text-success" : "text-text-tertiary"
                              }
                            >
                              {m.active ? "Active" : "Inactive"}
                            </Badge>
                          </td>
                          <td className="px-[18px] py-[14px] text-text-secondary">
                            {formatDate(m.created_at)}
                          </td>
                          <td className="px-[18px] py-[14px] text-right">
                            {!isMe && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setActive.mutate({ id: m.id, active: !m.active })
                                }
                              >
                                {m.active ? "Deactivate" : "Reactivate"}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          <TabsContent value="invites" className="mt-6">
            <div className="rounded-lg border border-border bg-surface shadow-card">
              {invitations.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={UserPlus}
                    title="No pending invitations"
                    description="Invitations appear here until the person signs up with that email."
                  />
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background text-left">
                      <th className="px-[18px] py-[14px] label-eyebrow">Email</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Role</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Invited</th>
                      <th className="px-[18px] py-[14px] label-eyebrow text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.map((inv) => (
                      <tr key={inv.id} className="border-t border-border-subtle hover:bg-background">
                        <td className="px-[18px] py-[14px] font-medium text-foreground">
                          {inv.email}
                        </td>
                        <td className="px-[18px] py-[14px]">
                          <Badge variant="outline">{inv.role}</Badge>
                        </td>
                        <td className="px-[18px] py-[14px] text-text-secondary">
                          {formatDate(inv.created_at)}
                        </td>
                        <td className="px-[18px] py-[14px] text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => cancelInvite.mutate(inv.id)}
                          >
                            Cancel
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          <TabsContent value="permissions" className="mt-6">
            <PermissionMatrix />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Invite User</DialogTitle>
            <DialogDescription>
              Enter their email and role. If they already have a Snout account, they're added now —
              otherwise they'll join your team automatically when they sign up.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Email *</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="person@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as StaffRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => invite.mutate()} disabled={invite.isPending}>
              {invite.isPending ? "Sending…" : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}

function PermissionMatrix() {
  const roles: Role[] = ["owner", "admin", "manager", "staff"];
  const allPerms = Array.from(
    new Set(roles.flatMap((r) => PERMISSIONS_BY_ROLE[r])),
  ).sort() as Permission[];

  return (
    <div className="rounded-lg border border-border bg-surface shadow-card overflow-hidden">
      <div className="border-b border-border-subtle p-5">
        <div className="font-display text-base text-foreground">Role Permissions</div>
        <p className="mt-1 text-sm text-text-secondary">
          Read-only matrix of what each role can do. Custom per-user overrides aren't supported yet.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-background text-left">
              <th className="px-[18px] py-[14px] label-eyebrow sticky left-0 bg-background">
                Permission
              </th>
              {roles.map((r) => (
                <th key={r} className="px-[18px] py-[14px] label-eyebrow text-center capitalize">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allPerms.map((p) => (
              <tr key={p} className="border-t border-border-subtle hover:bg-background">
                <td className="px-[18px] py-[10px] font-mono text-xs text-foreground sticky left-0 bg-surface">
                  {p}
                </td>
                {roles.map((r) => {
                  const has = PERMISSIONS_BY_ROLE[r].includes(p);
                  return (
                    <td key={r} className="px-[18px] py-[10px] text-center">
                      {has ? (
                        <Check className="inline h-4 w-4 text-success" />
                      ) : (
                        <X className="inline h-3.5 w-3.5 text-text-tertiary" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
