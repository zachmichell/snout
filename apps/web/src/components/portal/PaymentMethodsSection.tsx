import { useState } from "react";
import { CreditCard, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import StatusBadge from "@/components/portal/StatusBadge";
import {
  usePaymentMethods,
  useCreatePaymentMethod,
  useSetDefaultPaymentMethod,
  useDeletePaymentMethod,
} from "@/hooks/usePaymentMethods";

const BRANDS = ["Visa", "Mastercard", "Amex", "Discover", "Other"];

type Props = { ownerId: string };

export default function PaymentMethodsSection({ ownerId }: Props) {
  const { data: cards = [], isLoading } = usePaymentMethods(ownerId);
  const create = useCreatePaymentMethod();
  const setDefault = useSetDefaultPaymentMethod();
  const remove = useDeletePaymentMethod();

  const [adding, setAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [brand, setBrand] = useState("Visa");
  const [last4, setLast4] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);

  const reset = () => {
    setBrand("Visa");
    setLast4("");
    setMonth("");
    setYear("");
    setMakeDefault(false);
  };

  const submit = () => {
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (!/^\d{4}$/.test(last4)) return;
    if (!(m >= 1 && m <= 12)) return;
    if (!(y >= new Date().getFullYear() && y <= 2100)) return;
    create.mutate(
      {
        owner_id: ownerId,
        card_brand: brand,
        card_last_four: last4,
        expiry_month: m,
        expiry_year: y,
        is_default: makeDefault || cards.length === 0,
      },
      {
        onSuccess: () => {
          reset();
          setAdding(false);
        },
      },
    );
  };

  return (
    <div className="rounded-lg border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-border-subtle p-4">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-text-secondary" />
          <div className="font-display text-base">Payment Methods</div>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add Card
        </Button>
      </div>

      {isLoading ? (
        <div className="p-6 text-sm text-text-secondary">Loading…</div>
      ) : cards.length === 0 ? (
        <div className="p-8 text-center text-sm text-text-secondary">
          No saved cards yet.
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {cards.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-card-alt px-2 py-1 text-xs font-semibold text-foreground">
                  {c.card_brand}
                </span>
                <div>
                  <div className="font-medium text-foreground">
                    •••• {c.card_last_four}
                  </div>
                  <div className="text-xs text-text-secondary">
                    Exp {String(c.expiry_month).padStart(2, "0")}/
                    {String(c.expiry_year).slice(-2)}
                  </div>
                </div>
                {c.is_default && (
                  <StatusBadge tone="primary">
                    <Star className="mr-1 h-3 w-3" />
                    Default
                  </StatusBadge>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs font-semibold">
                {!c.is_default && (
                  <button
                    onClick={() => setDefault.mutate({ id: c.id, owner_id: ownerId })}
                    className="text-primary hover:underline"
                  >
                    Set default
                  </button>
                )}
                <button
                  onClick={() => setDeleteId(c.id)}
                  className="inline-flex items-center gap-1 text-destructive hover:underline"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={adding}
        onOpenChange={(o) => {
          setAdding(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Card</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Brand</Label>
              <Select value={brand} onValueChange={setBrand}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BRANDS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Last 4 digits</Label>
              <Input
                value={last4}
                inputMode="numeric"
                maxLength={4}
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))}
                placeholder="4242"
              />
            </div>
            <div>
              <Label className="text-xs">Expiry month (MM)</Label>
              <Input
                value={month}
                inputMode="numeric"
                maxLength={2}
                onChange={(e) => setMonth(e.target.value.replace(/\D/g, ""))}
                placeholder="03"
              />
            </div>
            <div>
              <Label className="text-xs">Expiry year (YYYY)</Label>
              <Input
                value={year}
                inputMode="numeric"
                maxLength={4}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
                placeholder="2028"
              />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm text-foreground">
              <Checkbox
                checked={makeDefault}
                onCheckedChange={(v) => setMakeDefault(!!v)}
              />
              Make this the default card
            </label>
            <p className="col-span-2 text-xs text-text-tertiary">
              Card numbers are not stored. Real card processing will be wired up
              when Stripe is connected.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={
                create.isPending ||
                last4.length !== 4 ||
                !month ||
                !year
              }
            >
              {create.isPending ? "Saving…" : "Save Card"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this card?</AlertDialogTitle>
            <AlertDialogDescription>
              The card will no longer be available for charging.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) remove.mutate({ id: deleteId, owner_id: ownerId });
                setDeleteId(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
