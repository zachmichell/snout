import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CANADIAN_SURCHARGE_CAP_BP,
  calculateSurchargeCents,
  DEFAULT_SURCHARGE_SETTINGS,
  type SurchargeSettings,
} from "@/lib/surcharge";
import { formatCentsShort } from "@/lib/money";

const CAP_PCT = (CANADIAN_SURCHARGE_CAP_BP / 100).toFixed(1);

export default function SurchargeTab() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();

  const { data: row, isLoading } = useQuery({
    queryKey: ["surcharge-settings", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from("surcharge_settings")
        .select(
          "id, enabled, rate_basis_points, applies_to_credit_only, customer_notice_text, registered_with_card_networks",
        )
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .maybeSingle();
      return data as
        | (SurchargeSettings & { id: string })
        | null;
    },
  });

  const [enabled, setEnabled] = useState(false);
  const [ratePctText, setRatePctText] = useState("0.0");
  const [appliesToCreditOnly, setAppliesToCreditOnly] = useState(true);
  const [notice, setNotice] = useState<string>("");
  const [registered, setRegistered] = useState(false);

  // Load existing values when the row arrives.
  useEffect(() => {
    if (!row) {
      const d = DEFAULT_SURCHARGE_SETTINGS;
      setEnabled(d.enabled);
      setRatePctText((d.rate_basis_points / 100).toFixed(1));
      setAppliesToCreditOnly(d.applies_to_credit_only);
      setNotice(d.customer_notice_text ?? "");
      setRegistered(d.registered_with_card_networks);
      return;
    }
    setEnabled(row.enabled);
    setRatePctText((row.rate_basis_points / 100).toFixed(1));
    setAppliesToCreditOnly(row.applies_to_credit_only);
    setNotice(row.customer_notice_text ?? "");
    setRegistered(row.registered_with_card_networks);
  }, [row]);

  const ratePct = Number(ratePctText);
  const ratePctValid =
    Number.isFinite(ratePct) && ratePct >= 0 && ratePct <= CANADIAN_SURCHARGE_CAP_BP / 100;
  const rateBp = Math.round(ratePct * 100);

  const sample100 = calculateSurchargeCents({
    amount_cents: 10000,
    rate_basis_points: rateBp,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No organization");
      if (!ratePctValid) throw new Error(`Rate must be between 0% and ${CAP_PCT}%`);
      const payload = {
        organization_id: orgId,
        enabled,
        rate_basis_points: rateBp,
        applies_to_credit_only: appliesToCreditOnly,
        customer_notice_text: notice.trim() || null,
        registered_with_card_networks: registered,
      };
      if (row?.id) {
        const { error } = await supabase
          .from("surcharge_settings")
          .update(payload)
          .eq("id", row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("surcharge_settings").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Surcharge settings saved");
      qc.invalidateQueries({ queryKey: ["surcharge-settings", orgId] });
      qc.invalidateQueries({ queryKey: ["pos-surcharge-settings", orgId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save settings"),
  });

  if (!orgId) return null;

  const willApply = enabled && registered;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg text-foreground">Credit-card surcharge</h2>
        <p className="mt-1 text-xs text-text-secondary">
          Pass credit-card processing fees to the customer at the point of sale. Under the
          October 2022 Visa and Mastercard settlement, Canadian merchants may surcharge credit
          cards up to {CAP_PCT}% after registering with the card networks. Debit cards remain
          exempt. Each province has additional disclosure rules; the customer notice below is
          what staff and the cart UI will show.
        </p>
      </div>

      {!registered && enabled && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-light p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            Surcharge is enabled but not yet attested. Until you confirm registration with
            Visa and Mastercard below, the cart will not add a surcharge.
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface p-5 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium text-foreground">Enable surcharge</div>
            <div className="text-xs text-text-secondary">
              Master switch. Off means no card payment is ever surcharged.
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={isLoading} />
        </div>

        <div>
          <Label className="text-xs">Surcharge rate</Label>
          <div className="mt-1 flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={CANADIAN_SURCHARGE_CAP_BP / 100}
              step={0.1}
              value={ratePctText}
              onChange={(e) => setRatePctText(e.target.value)}
              className="w-28"
            />
            <span className="text-sm text-text-secondary">% (capped at {CAP_PCT}%)</span>
          </div>
          {!ratePctValid && (
            <p className="mt-1 text-xs text-destructive">
              Rate must be between 0% and {CAP_PCT}%.
            </p>
          )}
        </div>

        <div>
          <Label className="text-xs">Applies to</Label>
          <Select
            value={appliesToCreditOnly ? "credit" : "all"}
            onValueChange={(v) => setAppliesToCreditOnly(v === "credit")}
          >
            <SelectTrigger className="mt-1 w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="credit">Credit cards only (recommended)</SelectItem>
              <SelectItem value="all">All card payments (credit and debit)</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-text-tertiary">
            Canadian rules permit surcharge on credit cards only. Pick "All card payments" only
            if you operate in a jurisdiction that allows surcharging debit.
          </p>
        </div>

        <div>
          <Label className="text-xs">Customer notice</Label>
          <Textarea
            rows={2}
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
            placeholder="A 2.4% credit-card surcharge applies. Pay by debit or cash to avoid this fee."
            className="mt-1"
          />
          <p className="mt-1 text-xs text-text-tertiary">
            Shown on the cart total and on the printed receipt when a surcharge is applied.
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-md border border-border bg-background p-3">
          <Switch checked={registered} onCheckedChange={setRegistered} id="registered" />
          <div className="flex-1">
            <Label htmlFor="registered" className="text-sm font-medium text-foreground">
              I have registered with Visa and Mastercard to apply this surcharge.
            </Label>
            <p className="mt-1 text-xs text-text-tertiary">
              Card-network registration is required before surcharging. The cart will not apply
              the surcharge until this is confirmed, even if the master switch is on.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border-subtle pt-4">
          <div className="text-xs text-text-tertiary">
            On a $100.00 charge, the surcharge would be{" "}
            <span className="font-semibold text-foreground">{formatCentsShort(sample100)}</span>{" "}
            ({willApply ? "will apply" : "configured but inactive"}).
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !ratePctValid}>
            {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save settings
          </Button>
        </div>
      </div>
    </div>
  );
}
