import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Megaphone, Send } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime } from "@/lib/money";

type Campaign = {
  id: string;
  name: string;
  subject: string;
  body: string;
  segment: string;
  recipient_count: number;
  status: string;
  sent_at: string | null;
  created_at: string;
};

const SEGMENT_LABEL: Record<string, string> = {
  all: "All Customers",
  active_clients: "Active Clients",
  lapsed: "Lapsed Clients",
  custom: "Custom",
};

const STATUS_VARIANT: Record<string, string> = {
  draft: "border-text-tertiary text-text-tertiary",
  scheduled: "border-warning text-warning",
  sent: "border-success text-success",
};

function emptyForm() {
  return {
    name: "",
    subject: "",
    body: "",
    segment: "all",
  };
}

export default function Marketing() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: emailSettings } = useQuery({
    queryKey: ["email-settings-marketing", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from("email_settings")
        .select("sender_name")
        .eq("organization_id", orgId!)
        .maybeSingle();
      return data;
    },
  });

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["campaigns", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_campaigns")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Campaign[];
    },
  });

  const countRecipients = async (segment: string) => {
    if (!orgId) return 0;
    let q = supabase
      .from("owners")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .not("email", "is", null);
    if (segment === "active_clients") {
      // owners with at least one reservation in last 90 days — approximated by all for v1
    }
    const { count } = await q;
    return count ?? 0;
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const openEdit = (c: Campaign) => {
    setEditing(c);
    setForm({
      name: c.name,
      subject: c.subject,
      body: c.body,
      segment: c.segment,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async (action: "draft" | "send") => {
      if (!form.name.trim()) throw new Error("Campaign name required");
      const recipientCount = await countRecipients(form.segment);
      const payload: any = {
        name: form.name.trim(),
        subject: form.subject.trim(),
        body: form.body,
        segment: form.segment,
        recipient_count: recipientCount,
        status: action === "send" ? "sent" : "draft",
        sent_at: action === "send" ? new Date().toISOString() : null,
        organization_id: orgId!,
      };
      if (editing) {
        const { error } = await supabase
          .from("email_campaigns")
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("email_campaigns").insert(payload);
        if (error) throw error;
      }
      return action;
    },
    onSuccess: (action) => {
      toast.success(action === "send" ? "Campaign sent" : "Draft saved");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["campaigns", orgId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Marketing"
          description={`Run email campaigns from ${emailSettings?.sender_name ?? "your organization"}`}
          actions={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> New Campaign
            </Button>
          }
        />

        <div className="rounded-lg border border-border bg-surface shadow-card">
          {isLoading ? (
            <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
          ) : campaigns.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Megaphone}
                title="No campaigns yet"
                description="Create email campaigns to engage customers with promotions and updates."
                action={
                  <Button onClick={openCreate}>
                    <Plus className="h-4 w-4" /> New Campaign
                  </Button>
                }
              />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-background text-left">
                  <th className="px-[18px] py-[14px] label-eyebrow">Name</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Subject</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Audience</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Recipients</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Status</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Sent</th>
                  <th className="px-[18px] py-[14px]"></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-t border-border-subtle hover:bg-background">
                    <td className="px-[18px] py-[14px] font-medium text-foreground">{c.name}</td>
                    <td className="px-[18px] py-[14px] text-text-secondary">{c.subject || "—"}</td>
                    <td className="px-[18px] py-[14px] text-text-secondary">
                      {SEGMENT_LABEL[c.segment] ?? c.segment}
                    </td>
                    <td className="px-[18px] py-[14px] text-foreground">{c.recipient_count}</td>
                    <td className="px-[18px] py-[14px]">
                      <Badge variant="outline" className={STATUS_VARIANT[c.status]}>
                        {c.status}
                      </Badge>
                    </td>
                    <td className="px-[18px] py-[14px] text-text-secondary">
                      {c.sent_at ? formatDateTime(c.sent_at) : "—"}
                    </td>
                    <td className="px-[18px] py-[14px] text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                        {c.status === "sent" ? "View" : "Edit"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display">
              {editing ? "Edit Campaign" : "New Campaign"}
            </DialogTitle>
            <DialogDescription>
              Compose a marketing email. From:{" "}
              <span className="font-medium">{emailSettings?.sender_name ?? "Your business"}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Campaign Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. November Promotion"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Audience</Label>
              <Select
                value={form.segment}
                onValueChange={(v) => setForm({ ...form, segment: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Customers</SelectItem>
                  <SelectItem value="active_clients">Active Clients</SelectItem>
                  <SelectItem value="lapsed">Lapsed Clients</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Subject</Label>
              <Input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="Email subject line"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email Body</Label>
              <Textarea
                rows={8}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder="Write your message here…"
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => save.mutate("draft")}
              disabled={save.isPending}
            >
              Save Draft
            </Button>
            <Button onClick={() => save.mutate("send")} disabled={save.isPending}>
              <Send className="h-4 w-4" />
              {save.isPending ? "Sending…" : "Send Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
