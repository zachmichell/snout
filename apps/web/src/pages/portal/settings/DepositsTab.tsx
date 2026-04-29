import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function DepositsTab() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  const orgId = membership?.organization_id ?? "";

  const { data: settings, isLoading } = useQuery({
    queryKey: ["deposit-settings", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deposit_settings")
        .select("*")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: services = [] } = useQuery({
    queryKey: ["services-for-deposits", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, base_price_cents")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: overrides = [] } = useQuery({
    queryKey: ["service-deposit-overrides", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_deposit_overrides")
        .select("*")
        .eq("organization_id", orgId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [enabled, setEnabled] = useState(false);
  const [amountType, setAmountType] = useState<"fixed" | "percentage">("percentage");
  const [defaultAmount, setDefaultAmount] = useState("0.00");
  const [defaultPct, setDefaultPct] = useState("25");
  const [refundPolicy, setRefundPolicy] = useState<"full" | "partial" | "none">("partial");
  const [cutoffHours, setCutoffHours] = useState("48");

  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled);
      setAmountType((settings.amount_type as "fixed" | "percentage") ?? "percentage");
      setDefaultAmount(((settings.default_amount_cents ?? 0) / 100).toFixed(2));
      setDefaultPct(((settings.default_percentage_bp ?? 0) / 100).toString());
      setRefundPolicy((settings.refund_policy as "full" | "partial" | "none") ?? "partial");
      setCutoffHours(String(settings.refund_cutoff_hours ?? 48));
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No organization");
      const payload = {
        organization_id: orgId,
        enabled,
        amount_type: amountType,
        default_amount_cents: Math.round(Number(defaultAmount || "0") * 100),
        default_percentage_bp: Math.round(Number(defaultPct || "0") * 100),
        refund_policy: refundPolicy,
        refund_cutoff_hours: Math.max(0, Math.floor(Number(cutoffHours || "0"))),
      };
      if (settings) {
        const { error } = await supabase.from("deposit_settings").update(payload).eq("id", settings.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("deposit_settings").insert(payload);
        if (error) throw error;
      }
      await logActivity({
        organization_id: orgId,
        action: settings ? "updated" : "created",
        entity_type: "deposit_settings",
        entity_id: settings?.id ?? null,
        metadata: { enabled },
      });
    },
    onSuccess: () => {
      toast.success("Deposit settings saved");
      qc.invalidateQueries({ queryKey: ["deposit-settings"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  // Per-service override editor state
  const [newServiceId, setNewServiceId] = useState("");
  const [newAmountType, setNewAmountType] = useState<"fixed" | "percentage">("percentage");
  const [newAmount, setNewAmount] = useState("0.00");
  const [newPct, setNewPct] = useState("25");

  const addOverride = useMutation({
    mutationFn: async () => {
      if (!orgId || !newServiceId) throw new Error("Pick a service");
      const { error } = await supabase.from("service_deposit_overrides").insert({
        organization_id: orgId,
        service_id: newServiceId,
        amount_type: newAmountType,
        amount_cents: Math.round(Number(newAmount || "0") * 100),
        percentage_bp: Math.round(Number(newPct || "0") * 100),
        enabled: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Override added");
      setNewServiceId("");
      qc.invalidateQueries({ queryKey: ["service-deposit-overrides"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const removeOverride = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("service_deposit_overrides").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Override removed");
      qc.invalidateQueries({ queryKey: ["service-deposit-overrides"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const usedServiceIds = new Set(overrides.map((o: any) => o.service_id));
  const availableServices = services.filter((s: any) => !usedServiceIds.has(s.id));

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-border bg-card p-6">
        <h3 className="font-display text-lg font-semibold mb-1">Deposit Defaults</h3>
        <p className="text-sm text-muted-foreground mb-5">Configure when and how much to collect upfront.</p>

        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base cursor-pointer">Require deposits for new reservations</Label>
              <p className="text-xs text-muted-foreground mt-0.5">When on, the booking flow will prompt for a deposit.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Amount Type</Label>
              <Select value={amountType} onValueChange={(v) => setAmountType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage of total</SelectItem>
                  <SelectItem value="fixed">Fixed amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {amountType === "fixed" ? (
              <div>
                <Label>Default Amount</Label>
                <Input type="number" step="0.01" min={0} value={defaultAmount} onChange={(e) => setDefaultAmount(e.target.value)} />
              </div>
            ) : (
              <div>
                <Label>Default Percentage (%)</Label>
                <Input type="number" step="0.01" min={0} max={100} value={defaultPct} onChange={(e) => setDefaultPct(e.target.value)} />
              </div>
            )}
            <div>
              <Label>Refund Policy</Label>
              <Select value={refundPolicy} onValueChange={(v) => setRefundPolicy(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Fully refundable</SelectItem>
                  <SelectItem value="partial">Partially refundable</SelectItem>
                  <SelectItem value="none">Non-refundable</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Refund Cutoff (hours before start)</Label>
              <Input type="number" min={0} value={cutoffHours} onChange={(e) => setCutoffHours(e.target.value)} />
            </div>
          </div>

          <div>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save Settings"}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <h3 className="font-display text-lg font-semibold mb-1">Per-Service Overrides</h3>
        <p className="text-sm text-muted-foreground mb-5">Optionally use different deposit rules for specific services.</p>

        <div className="rounded-md border border-border overflow-hidden mb-4">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Service</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="w-[80px] text-right">Remove</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overrides.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground text-sm">No overrides yet — defaults apply to all services.</TableCell></TableRow>
              ) : overrides.map((o: any) => {
                const svc = services.find((s: any) => s.id === o.service_id);
                return (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{svc?.name ?? "—"}</TableCell>
                    <TableCell>{o.amount_type === "fixed" ? "Fixed" : "Percentage"}</TableCell>
                    <TableCell className="text-right">
                      {o.amount_type === "fixed"
                        ? `$${(o.amount_cents / 100).toFixed(2)}`
                        : `${(o.percentage_bp / 100).toFixed(2)}%`}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => removeOverride.mutate(o.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <Label>Service</Label>
            <Select value={newServiceId} onValueChange={setNewServiceId}>
              <SelectTrigger><SelectValue placeholder="Pick a service" /></SelectTrigger>
              <SelectContent>
                {availableServices.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Type</Label>
            <Select value={newAmountType} onValueChange={(v) => setNewAmountType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">%</SelectItem>
                <SelectItem value="fixed">Fixed $</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {newAmountType === "fixed" ? (
            <div>
              <Label>Amount</Label>
              <Input type="number" step="0.01" min={0} value={newAmount} onChange={(e) => setNewAmount(e.target.value)} />
            </div>
          ) : (
            <div>
              <Label>Percent</Label>
              <Input type="number" step="0.01" min={0} max={100} value={newPct} onChange={(e) => setNewPct(e.target.value)} />
            </div>
          )}
          <div className="md:col-span-4">
            <Button onClick={() => addOverride.mutate()} disabled={!newServiceId || addOverride.isPending}>
              Add Override
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
