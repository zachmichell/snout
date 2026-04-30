import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { TIMEZONE_OPTIONS } from "@/lib/timezones";

export default function OrganizationTab() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();

  const { data: org, isLoading } = useQuery({
    queryKey: ["org", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", orgId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [cancellationHours, setCancellationHours] = useState("24");
  const [groomingCancellationHours, setGroomingCancellationHours] = useState("48");

  useEffect(() => {
    if (org) {
      setName(org.name);
      setTimezone(org.timezone);
      setCancellationHours(String(org.cancellation_policy_hours ?? 24));
      setGroomingCancellationHours(String(org.grooming_cancellation_policy_hours ?? 48));
    }
  }, [org]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const cancelH = Math.max(0, parseInt(cancellationHours, 10) || 0);
      const groomCancelH = Math.max(0, parseInt(groomingCancellationHours, 10) || 0);
      const { error } = await supabase
        .from("organizations")
        .update({
          name,
          timezone,
          cancellation_policy_hours: cancelH,
          grooming_cancellation_policy_hours: groomCancelH,
        })
        .eq("id", orgId!);
      if (error) throw error;
      const { logActivity } = await import("@/lib/activity");
      await logActivity({
        organization_id: orgId!,
        action: "updated",
        entity_type: "organization",
        entity_id: orgId!,
        metadata: { name, timezone, cancellation_policy_hours: cancelH, grooming_cancellation_policy_hours: groomCancelH },
      });
    },
    onSuccess: () => {
      toast.success("Organization updated");
      qc.invalidateQueries({ queryKey: ["org", orgId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update"),
  });

  const isDirty =
    name !== (org?.name ?? "") ||
    timezone !== (org?.timezone ?? "") ||
    parseInt(cancellationHours, 10) !== (org?.cancellation_policy_hours ?? 24) ||
    parseInt(groomingCancellationHours, 10) !== (org?.grooming_cancellation_policy_hours ?? 48);

  if (isLoading || !org) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="font-display text-base">Organization details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="org-name">Name</Label>
          <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="org-slug" className="flex items-center gap-1.5">
            Subdomain
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>Contact support to change</TooltipContent>
            </Tooltip>
          </Label>
          <div className="flex items-center gap-2">
            <Input id="org-slug" value={org.slug} readOnly className="bg-muted" />
            <span className="whitespace-nowrap text-sm text-muted-foreground">.snout.app</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              Country
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>Contact support to change</TooltipContent>
              </Tooltip>
            </Label>
            <Input value={org.country} readOnly className="bg-muted" />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              Currency
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>Contact support to change</TooltipContent>
              </Tooltip>
            </Label>
            <Input value={org.currency} readOnly className="bg-muted" />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Timezone</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border border-border-subtle bg-muted/20 p-4 space-y-4">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-foreground">Cancellation policy</h3>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Cancellations made within this many hours of the appointment may incur a fee per your facility's policy. Pet parents see a warning when they try to cancel inside the window.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cancel-hours">General reservations</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="cancel-hours"
                  type="number"
                  min={0}
                  max={720}
                  value={cancellationHours}
                  onChange={(e) => setCancellationHours(e.target.value)}
                />
                <span className="whitespace-nowrap text-sm text-muted-foreground">hours</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Daycare, boarding, training, etc. Default: 24 hours.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="groom-cancel-hours">Grooming appointments</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="groom-cancel-hours"
                  type="number"
                  min={0}
                  max={720}
                  value={groomingCancellationHours}
                  onChange={(e) => setGroomingCancellationHours(e.target.value)}
                />
                <span className="whitespace-nowrap text-sm text-muted-foreground">hours</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Typically longer — groomer slots are harder to refill. Default: 48 hours.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <Button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !isDirty}
          >
            {saveMut.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
