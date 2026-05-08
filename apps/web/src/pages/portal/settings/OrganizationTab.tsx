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

  useEffect(() => {
    if (org) {
      setName(org.name);
      setTimezone(org.timezone);
    }
  }, [org]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("organizations")
        .update({ name, timezone })
        .eq("id", orgId!);
      if (error) throw error;
      const { logActivity } = await import("@/lib/activity");
      await logActivity({
        organization_id: orgId!,
        action: "updated",
        entity_type: "organization",
        entity_id: orgId!,
        metadata: { name, timezone },
      });
    },
    onSuccess: () => {
      toast.success("Organization updated");
      qc.invalidateQueries({ queryKey: ["org", orgId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update"),
  });

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

        <div className="pt-2">
          <Button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || (name === org.name && timezone === org.timezone)}
          >
            {saveMut.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
