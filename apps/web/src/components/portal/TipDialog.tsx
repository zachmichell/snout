import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called with the tip amount in cents (or null to skip).
   * The promise resolves once the parent has finished saving.
   */
  onConfirm: (tipCents: number | null) => void | Promise<void>;
  title?: string;
  description?: string;
  /**
   * When true, the "No Tip / Skip" button is styled prominently as a primary
   * skip path (used at general reservation checkout where tipping is optional).
   * Defaults to false (grooming-style: tip is part of the workflow).
   */
  skippable?: boolean;
  confirmLabel?: string;
  busy?: boolean;
};

const QUICK = [500, 1000, 1500, 2000];

export default function TipDialog({
  open,
  onOpenChange,
  onConfirm,
  title = "Add Tip",
  description,
  skippable = false,
  confirmLabel = "Save tip",
  busy = false,
}: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState<string>("");

  const reset = () => {
    setSelected(null);
    setCustom("");
  };

  const handle = async (val: number | null) => {
    await onConfirm(val);
    reset();
  };

  const customCents = (() => {
    const n = parseFloat(custom);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  })();

  const finalCents = selected ?? customCents;

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
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {QUICK.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setSelected(c);
                  setCustom("");
                }}
                className={cn(
                  "rounded-lg border px-3 py-3 text-sm font-semibold transition-colors",
                  selected === c
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                ${c / 100}
              </button>
            ))}
          </div>

          <div>
            <Label htmlFor="custom-tip" className="text-xs text-text-secondary">
              Custom amount
            </Label>
            <div className="relative mt-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
                $
              </span>
              <Input
                id="custom-tip"
                inputMode="decimal"
                placeholder="0.00"
                value={custom}
                onChange={(e) => {
                  setCustom(e.target.value);
                  setSelected(null);
                }}
                className="pl-7"
              />
            </div>
          </div>

          {finalCents !== null && (
            <div className="rounded-md bg-surface px-3 py-2 text-sm text-foreground">
              Tip:{" "}
              <span className="font-semibold">
                ${(finalCents / 100).toFixed(2)}
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant={skippable ? "default" : "outline"}
            onClick={() => handle(null)}
            disabled={busy}
            className={skippable ? "" : ""}
          >
            {skippable ? "Skip" : "No Tip"}
          </Button>
          <Button
            type="button"
            onClick={() => handle(finalCents)}
            disabled={busy || finalCents === null}
          >
            {busy ? "Saving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
