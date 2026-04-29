import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

const TOGGLES: { key: keyof Settings; title: string; desc: string }[] = [
  {
    key: "reservation_confirmation_enabled",
    title: "Reservation Confirmation",
    desc: "Sent when a reservation is confirmed",
  },
  {
    key: "invoice_created_enabled",
    title: "Invoice Created",
    desc: "Sent when an invoice is issued",
  },
  {
    key: "report_card_published_enabled",
    title: "Report Card Published",
    desc: "Sent when a report card is published",
  },
  {
    key: "waiver_reminder_enabled",
    title: "Waiver Reminder",
    desc: "Sent when waivers need signature",
  },
];

interface Settings {
  id?: string;
  organization_id: string;
  sender_name: string | null;
  reservation_confirmation_enabled: boolean;
  invoice_created_enabled: boolean;
  report_card_published_enabled: boolean;
  waiver_reminder_enabled: boolean;
}

export default function EmailTab() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const [senderName, setSenderName] = useState("");
  const [senderDirty, setSenderDirty] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["email-settings", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_settings")
        .select("*")
        .eq("organization_id", orgId!)
        .maybeSingle();
      if (error) throw error;
      if (data) return data as Settings;
      // create row if missing
      const { data: org } = await supabase.from("organizations").select("name").eq("id", orgId!).maybeSingle();
      const { data: created, error: insErr } = await supabase
        .from("email_settings")
        .insert({ organization_id: orgId!, sender_name: org?.name ?? null })
        .select("*")
        .single();
      if (insErr) throw insErr;
      return created as Settings;
    },
  });

  useEffect(() => {
    if (settings && !senderDirty) setSenderName(settings.sender_name ?? "");
  }, [settings, senderDirty]);

  const update = async (patch: Partial<Settings>) => {
    if (!orgId) return;
    const { error } = await supabase
      .from("email_settings")
      .update(patch as any)
      .eq("organization_id", orgId);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["email-settings", orgId] });
    toast.success("Saved");
  };

  const saveSender = async () => {
    await update({ sender_name: senderName.trim() || null });
    setSenderDirty(false);
  };

  if (isLoading || !settings) {
    return <div className="text-sm text-text-secondary">Loading…</div>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="font-display text-lg text-foreground">Email Notifications</h2>
        <p className="mt-1 text-sm text-text-secondary">Manage which emails are sent to customers</p>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
        <Label htmlFor="sender_name" className="text-xs font-semibold text-text-secondary">
          Sender Name
        </Label>
        <Input
          id="sender_name"
          value={senderName}
          onChange={(e) => {
            setSenderName(e.target.value);
            setSenderDirty(true);
          }}
          className="mt-1.5 bg-background"
          placeholder="Your business name"
        />
        <p className="mt-1.5 text-xs text-text-tertiary">Appears in the "from" line of emails</p>
        {senderDirty && (
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSenderName(settings.sender_name ?? "");
                setSenderDirty(false);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={saveSender}>
              Save
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-surface shadow-card">
        {TOGGLES.map((t, i) => (
          <div
            key={t.key}
            className={`flex items-center justify-between gap-4 p-5 ${i < TOGGLES.length - 1 ? "border-b border-border-subtle" : ""}`}
          >
            <div>
              <div className="font-medium text-foreground">{t.title}</div>
              <div className="mt-0.5 text-sm text-text-secondary">{t.desc}</div>
            </div>
            <Switch
              checked={Boolean(settings[t.key])}
              onCheckedChange={(checked) => update({ [t.key]: checked } as Partial<Settings>)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
