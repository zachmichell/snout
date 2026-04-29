import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Phone, Mail, Bell } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type Channel = "sms" | "email" | "in_app";

type EventDef = {
  event_type: string;
  label: string;
  description: string;
  defaultTemplate: string;
};

const EVENTS: EventDef[] = [
  {
    event_type: "reservation_reminder",
    label: "Reservation Reminder",
    description: "Sent 24 hours before a scheduled reservation",
    defaultTemplate:
      "Hi {{owner_name}}, just a reminder that {{pet_name}} is booked for {{service}} on {{date}}.",
  },
  {
    event_type: "check_in",
    label: "Check-In Confirmation",
    description: "Sent when a pet is checked in",
    defaultTemplate: "Hi {{owner_name}}! {{pet_name}} just checked in. We'll take great care!",
  },
  {
    event_type: "check_out",
    label: "Check-Out Notification",
    description: "Sent when a pet is checked out",
    defaultTemplate: "{{pet_name}} is ready for pickup! See you soon.",
  },
  {
    event_type: "incident_alert",
    label: "Incident Alert",
    description: "Sent when an incident is logged for the owner's pet",
    defaultTemplate:
      "Hi {{owner_name}}, we wanted to let you know about an incident with {{pet_name}}. Please contact us when you can.",
  },
  {
    event_type: "report_card_ready",
    label: "Report Card Ready",
    description: "Sent when a report card is published",
    defaultTemplate: "{{pet_name}}'s report card is ready! View it in your portal.",
  },
  {
    event_type: "invoice_due",
    label: "Invoice Due",
    description: "Sent when an invoice is created",
    defaultTemplate: "You have a new invoice for {{amount}}. Pay anytime in your portal.",
  },
];

const CHANNELS: { key: Channel; label: string; icon: typeof Phone }[] = [
  { key: "sms", label: "SMS", icon: Phone },
  { key: "email", label: "Email", icon: Mail },
  { key: "in_app", label: "In-App", icon: Bell },
];

type Setting = {
  id?: string;
  event_type: string;
  channel: Channel;
  enabled: boolean;
  template_text: string;
};

export default function SmsComms() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ["notif-settings", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_settings")
        .select("*")
        .eq("organization_id", orgId!);
      if (error) throw error;
      return (data ?? []) as Setting[];
    },
  });

  const findSetting = (event_type: string, channel: Channel): Setting | undefined =>
    settings.find((s) => s.event_type === event_type && s.channel === channel);

  const upsert = useMutation({
    mutationFn: async (s: Setting) => {
      const existing = findSetting(s.event_type, s.channel);
      if (existing?.id) {
        const { error } = await supabase
          .from("notification_settings")
          .update({
            enabled: s.enabled,
            template_text: s.template_text,
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("notification_settings").insert({
          organization_id: orgId!,
          event_type: s.event_type,
          channel: s.channel,
          enabled: s.enabled,
          template_text: s.template_text,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notif-settings", orgId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = (event_type: string, channel: Channel, enabled: boolean) => {
    const existing = findSetting(event_type, channel);
    const ev = EVENTS.find((e) => e.event_type === event_type);
    upsert.mutate({
      event_type,
      channel,
      enabled,
      template_text: existing?.template_text ?? ev?.defaultTemplate ?? "",
    });
  };

  const saveTemplate = (event_type: string, channel: Channel) => {
    const key = `${event_type}::${channel}`;
    const text = drafts[key] ?? "";
    const existing = findSetting(event_type, channel);
    upsert.mutate({
      event_type,
      channel,
      enabled: existing?.enabled ?? false,
      template_text: text,
    });
    toast.success("Template saved");
  };

  const getTemplate = (event_type: string, channel: Channel) => {
    const key = `${event_type}::${channel}`;
    if (drafts[key] != null) return drafts[key];
    const existing = findSetting(event_type, channel);
    if (existing) return existing.template_text;
    return EVENTS.find((e) => e.event_type === event_type)?.defaultTemplate ?? "";
  };

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="SMS & Comms"
          description="Configure notification channels and message templates"
        />

        <div className="rounded-lg border border-border bg-card-alt p-4 shadow-card mb-6">
          <div className="flex items-start gap-3">
            <Phone className="h-4 w-4 text-accent mt-0.5" />
            <div className="text-sm text-text-secondary">
              <span className="font-medium text-foreground">SMS provider not configured.</span>{" "}
              Templates and toggles can be managed now. SMS delivery will be enabled when you connect
              a provider (e.g. Twilio).
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
        ) : (
          <div className="space-y-4">
            {EVENTS.map((ev) => (
              <div key={ev.event_type} className="rounded-lg border border-border bg-surface shadow-card">
                <div className="border-b border-border-subtle p-5">
                  <div className="font-display text-base text-foreground">{ev.label}</div>
                  <div className="mt-0.5 text-sm text-text-secondary">{ev.description}</div>
                </div>
                <div className="divide-y divide-border-subtle">
                  {CHANNELS.map((ch) => {
                    const s = findSetting(ev.event_type, ch.key);
                    const enabled = s?.enabled ?? false;
                    const Icon = ch.icon;
                    return (
                      <div key={ch.key} className="p-5">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-text-tertiary" />
                            <Label className="text-sm font-medium">{ch.label}</Label>
                          </div>
                          <Switch
                            checked={enabled}
                            onCheckedChange={(v) => toggle(ev.event_type, ch.key, v)}
                          />
                        </div>
                        {enabled && (
                          <div className="mt-3 space-y-2">
                            <Label className="text-xs text-text-tertiary">Template</Label>
                            <Textarea
                              rows={2}
                              value={getTemplate(ev.event_type, ch.key)}
                              onChange={(e) =>
                                setDrafts({
                                  ...drafts,
                                  [`${ev.event_type}::${ch.key}`]: e.target.value,
                                })
                              }
                            />
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => saveTemplate(ev.event_type, ch.key)}
                              >
                                Save
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
