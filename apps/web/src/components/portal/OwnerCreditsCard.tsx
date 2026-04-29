import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Minus, Coins } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useActiveStaff } from "@/contexts/StaffCodeContext";
import { useAuth } from "@/hooks/useAuth";
import { useLogActivity } from "@/hooks/useLogActivity";
import { applyCreditAdjustment } from "@/lib/credits";

/**
 * Displays an owner's three credit balances and provides a dialog for staff
 * to adjust them manually. Adjustments record an entry on the owner's
 * activity log so changes are auditable.
 *
 * Note: this is the *manual* adjustment surface — typical credit changes
 * happen automatically (purchase → +N, check-out → −1). Staff use this when
 * doing one-off corrections, refills outside POS, or starting balances.
 */
type Owner = {
  id: string;
  organization_id: string;
  first_name: string | null;
  last_name: string | null;
  daycare_full_day_credits: number | null;
  daycare_half_day_credits: number | null;
  boarding_night_credits: number | null;
};

export function OwnerCreditsCard({ owner }: { owner: Owner }) {
  const [open, setOpen] = useState(false);

  const full = owner.daycare_full_day_credits ?? 0;
  const half = owner.daycare_half_day_credits ?? 0;
  const nights = owner.boarding_night_credits ?? 0;

  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-display text-base">Credits</div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1">
          <Coins className="h-3.5 w-3.5" />
          Adjust
        </Button>
      </div>
      <dl className="grid grid-cols-3 gap-4 text-sm">
        <CreditStat label="Daycare · Full" value={full} />
        <CreditStat label="Daycare · Half" value={half} />
        <CreditStat label="Boarding · Nights" value={nights} />
      </dl>
      <CreditsAdjustDialog open={open} onOpenChange={setOpen} owner={owner} />
    </div>
  );
}

function CreditStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-text-tertiary">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function CreditsAdjustDialog({
  open,
  onOpenChange,
  owner,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  owner: Owner;
}) {
  const log = useLogActivity();
  const { activeStaff } = useActiveStaff();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [fullDelta, setFullDelta] = useState<string>("0");
  const [halfDelta, setHalfDelta] = useState<string>("0");
  const [nightsDelta, setNightsDelta] = useState<string>("0");
  const [reason, setReason] = useState<string>("");

  const reset = () => {
    setFullDelta("0");
    setHalfDelta("0");
    setNightsDelta("0");
    setReason("");
  };

  const adjust = useMutation({
    mutationFn: async () => {
      const dFull = Number(fullDelta) || 0;
      const dHalf = Number(halfDelta) || 0;
      const dNights = Number(nightsDelta) || 0;

      if (dFull === 0 && dHalf === 0 && dNights === 0) {
        throw new Error("Enter at least one non-zero adjustment");
      }

      const actor = activeStaff
        ? {
            kind: "staff" as const,
            label: activeStaff.display_name || "Staff",
            staffCodeId: activeStaff.id,
          }
        : profile
          ? {
              kind: "staff" as const,
              label:
                [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
                profile.email ||
                "Staff",
            }
          : { kind: "system" as const, label: "System" };

      // Writes ledger rows (positive: one row; negative: FIFO across active
      // purchases). The trigger on credit_ledger refreshes the cache columns
      // on owners. Throws on insufficient.
      await applyCreditAdjustment({
        ownerId: owner.id,
        deltaFull: dFull,
        deltaHalf: dHalf,
        deltaNights: dNights,
        note: reason.trim() || null,
        actor,
      });

      const parts: string[] = [];
      const fmt = (n: number, unit: string) => `${n > 0 ? "+" : ""}${n} ${unit}`;
      if (dFull !== 0) parts.push(fmt(dFull, "full"));
      if (dHalf !== 0) parts.push(fmt(dHalf, "half"));
      if (dNights !== 0) parts.push(fmt(dNights, Math.abs(dNights) === 1 ? "night" : "nights"));

      await log({
        organization_id: owner.organization_id,
        action: "updated",
        entity_type: "owner",
        entity_id: owner.id,
        metadata: {
          summary: `Credits adjusted: ${parts.join(", ")}`,
          reason: reason.trim() || null,
          delta: { full: dFull, half: dHalf, nights: dNights },
        },
      });
    },
    onSuccess: () => {
      toast.success("Credits updated");
      qc.invalidateQueries({ queryKey: ["owner", owner.id] });
      qc.invalidateQueries({ queryKey: ["dashboard-day"] });
      qc.invalidateQueries({ queryKey: ["reservations"] });
      reset();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't update credits"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust credits</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-text-secondary">
            Enter a positive number to add, negative to remove. Leave a row at 0 to skip.
          </p>
          <DeltaRow
            label="Daycare · Full"
            current={owner.daycare_full_day_credits ?? 0}
            value={fullDelta}
            onChange={setFullDelta}
          />
          <DeltaRow
            label="Daycare · Half"
            current={owner.daycare_half_day_credits ?? 0}
            value={halfDelta}
            onChange={setHalfDelta}
          />
          <DeltaRow
            label="Boarding · Nights"
            current={owner.boarding_night_credits ?? 0}
            value={nightsDelta}
            onChange={setNightsDelta}
          />
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-text-secondary">
              Reason (optional)
            </label>
            <Textarea
              rows={2}
              placeholder="e.g. Sold 10-pack, comped 2 nights, correction…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => adjust.mutate()} disabled={adjust.isPending} className="gap-1">
            {adjust.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeltaRow({
  label,
  current,
  value,
  onChange,
}: {
  label: string;
  current: number;
  value: string;
  onChange: (v: string) => void;
}) {
  const delta = Number(value) || 0;
  const next = Math.max(0, current + delta);
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-text-tertiary">
          {current} → <span className={next === current ? "" : "text-foreground"}>{next}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onChange(String((Number(value) || 0) - 1))}
          aria-label={`Decrease ${label}`}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Input
          type="number"
          step={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-20 text-center"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onChange(String((Number(value) || 0) + 1))}
          aria-label={`Increase ${label}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
