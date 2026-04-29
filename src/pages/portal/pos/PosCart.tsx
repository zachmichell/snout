import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Search, Trash2, Plus, ShoppingCart, CreditCard, Save, X } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLocationFilter } from "@/contexts/LocationContext";
import { formatCentsShort, parseDollarsToCents, centsToDollarString } from "@/lib/money";
import { nextInvoiceNumber } from "@/lib/invoice";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import {
  calculateSurchargeCents,
  surchargeApplies,
  DEFAULT_SURCHARGE_SETTINGS,
  type SurchargeSettings,
} from "@/lib/surcharge";

type Item = {
  id: string;
  item_kind: "service" | "product" | "package";
  service_id: string | null;
  product_id: string | null;
  package_id: string | null;
  name: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
};

export default function PosCart() {
  const { membership, user } = useAuth();
  const orgId = membership?.organization_id;
  const locationId = useLocationFilter();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const cartIdFromUrl = params.get("cart");

  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerSearch, setOwnerSearch] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<any>(null);
  const [storeCreditInput, setStoreCreditInput] = useState("0.00");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "check" | "other" | "card" | "card_debit" | "card_on_file">("cash");
  const [notes, setNotes] = useState("");
  const [tab, setTab] = useState<"services" | "products" | "packages">("products");

  // Load existing open cart if ?cart=...
  const { data: existingCart } = useQuery({
    queryKey: ["pos-cart", cartIdFromUrl],
    enabled: !!cartIdFromUrl,
    queryFn: async () => {
      const { data: cart } = await supabase.from("pos_carts").select("*").eq("id", cartIdFromUrl!).maybeSingle();
      const { data: cartItems } = await supabase.from("pos_cart_items").select("*").eq("cart_id", cartIdFromUrl!);
      return { cart, items: cartItems ?? [] };
    },
  });

  useEffect(() => {
    if (existingCart?.cart) {
      setOwnerId(existingCart.cart.owner_id);
      setItems(existingCart.items as Item[]);
      setNotes(existingCart.cart.notes ?? "");
      setStoreCreditInput(centsToDollarString(existingCart.cart.applied_store_credit_cents ?? 0));
    }
  }, [existingCart]);

  // Owner search
  const { data: owners = [] } = useQuery({
    queryKey: ["pos-owner-search", orgId, ownerSearch],
    enabled: !!orgId && ownerSearch.length >= 1,
    queryFn: async () => {
      const { data } = await supabase
        .from("owners")
        .select("id, first_name, last_name, email, store_credit_cents")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .or(`first_name.ilike.%${ownerSearch}%,last_name.ilike.%${ownerSearch}%,email.ilike.%${ownerSearch}%`)
        .limit(10);
      return data ?? [];
    },
  });

  const { data: selectedOwner } = useQuery({
    queryKey: ["pos-owner", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data } = await supabase
        .from("owners").select("id, first_name, last_name, email, store_credit_cents")
        .eq("id", ownerId!).maybeSingle();
      return data;
    },
  });

  // Saved payment methods for the selected owner
  const { data: savedCards = [] } = usePaymentMethods(ownerId ?? undefined);
  const defaultCard = useMemo(() => savedCards.find((c) => c.is_default) ?? savedCards[0] ?? null, [savedCards]);

  // Auto-select card on file when an owner with a default card is chosen
  useEffect(() => {
    if (defaultCard && paymentMethod === "cash") {
      setPaymentMethod("card_on_file");
    }
    if (!savedCards.length && paymentMethod === "card_on_file") {
      setPaymentMethod("cash");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCard?.id, savedCards.length]);
  const { data: services = [] } = useQuery({
    queryKey: ["pos-services", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase.from("services")
        .select("id, name, base_price_cents, module")
        .eq("organization_id", orgId!).eq("active", true).is("deleted_at", null).order("name");
      if (locationId) q = q.eq("location_id", locationId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["pos-products", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("retail_products")
        .select("id, name, price_cents, stock_quantity, sku")
        .eq("organization_id", orgId!).eq("active", true).is("deleted_at", null).order("name");
      return data ?? [];
    },
  });

  const { data: packages = [] } = useQuery({
    queryKey: ["pos-packages", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("subscription_packages")
        .select("id, name, price_cents, included_credits, validity_days")
        .eq("organization_id", orgId!).eq("active", true).is("deleted_at", null).order("name");
      return data ?? [];
    },
  });

  // Surcharge config for this org. Falls back to the default off-state when no
  // row exists, so an org without surcharge configured behaves exactly as before.
  const { data: surchargeSettings = DEFAULT_SURCHARGE_SETTINGS } = useQuery<SurchargeSettings>({
    queryKey: ["pos-surcharge-settings", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from("surcharge_settings")
        .select(
          "enabled, rate_basis_points, applies_to_credit_only, customer_notice_text, registered_with_card_networks",
        )
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .maybeSingle();
      return (data as SurchargeSettings | null) ?? DEFAULT_SURCHARGE_SETTINGS;
    },
  });

  const { data: taxRules = [] } = useQuery({
    queryKey: ["pos-tax-rules", orgId, locationId],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase.from("tax_rules").select("id, name, rate_basis_points")
        .eq("organization_id", orgId!).eq("active", true).is("deleted_at", null);
      if (locationId) q = q.or(`location_id.eq.${locationId},location_id.is.null`);
      const { data } = await q;
      return data ?? [];
    },
  });

  // Totals
  const totals = useMemo(() => {
    const subtotal = items.reduce((s, i) => s + i.line_total_cents, 0);
    let discount = 0;
    if (appliedPromo) {
      if (appliedPromo.discount_type === "percent") {
        discount = Math.round((subtotal * appliedPromo.discount_value) / 10000);
      } else {
        discount = Math.min(subtotal, appliedPromo.discount_value);
      }
    }
    const afterDiscount = Math.max(0, subtotal - discount);
    const taxRate = taxRules.reduce((s, r: any) => s + r.rate_basis_points, 0);
    const tax = Math.round((afterDiscount * taxRate) / 10000);
    const beforeCredit = afterDiscount + tax;
    const creditCents = Math.min(
      Math.max(0, parseDollarsToCents(storeCreditInput) ?? 0),
      selectedOwner?.store_credit_cents ?? 0,
      beforeCredit,
    );
    // Pre-surcharge amount the customer is being charged.
    const cardChargeable = Math.max(0, beforeCredit - creditCents);

    // Surcharge applies only on the card portion. The UI distinguishes
    // credit and debit; cash / check / other never surcharge.
    const cardFunding =
      paymentMethod === "card" || paymentMethod === "card_on_file"
        ? "credit"
        : paymentMethod === "card_debit"
          ? "debit"
          : null;
    const surcharge = surchargeApplies({
      settings: surchargeSettings,
      payment_method: cardFunding ? "card" : (paymentMethod as string),
      card_funding: cardFunding,
    })
      ? calculateSurchargeCents({
          amount_cents: cardChargeable,
          rate_basis_points: surchargeSettings.rate_basis_points,
        })
      : 0;

    const total = cardChargeable + surcharge;
    return { subtotal, discount, tax, creditCents, surcharge, total };
  }, [items, appliedPromo, taxRules, storeCreditInput, selectedOwner, paymentMethod, surchargeSettings]);

  const addItem = (kind: "service" | "product" | "package", entity: any) => {
    const newItem: Item = {
      id: crypto.randomUUID(),
      item_kind: kind,
      service_id: kind === "service" ? entity.id : null,
      product_id: kind === "product" ? entity.id : null,
      package_id: kind === "package" ? entity.id : null,
      name: entity.name,
      quantity: 1,
      unit_price_cents: entity.price_cents ?? entity.base_price_cents ?? 0,
      line_total_cents: entity.price_cents ?? entity.base_price_cents ?? 0,
    };
    setItems((prev) => [...prev, newItem]);
  };

  const updateQty = (id: string, qty: number) => {
    const q = Math.max(1, qty);
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, quantity: q, line_total_cents: q * i.unit_price_cents } : i));
  };

  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  const applyPromo = async () => {
    if (!promoCode.trim() || !orgId) return;
    const { data } = await supabase.from("promotions")
      .select("*").eq("organization_id", orgId)
      .ilike("code", promoCode.trim())
      .eq("active", true).is("deleted_at", null).maybeSingle();
    if (!data) { toast.error("Code not found or inactive"); return; }
    const now = new Date();
    if (data.valid_from && new Date(data.valid_from) > now) { toast.error("Code not yet valid"); return; }
    if (data.valid_to && new Date(data.valid_to) < now) { toast.error("Code expired"); return; }
    if (data.max_uses != null && data.usage_count >= data.max_uses) { toast.error("Code usage limit reached"); return; }
    setAppliedPromo(data);
    toast.success(`Applied ${data.code}`);
  };

  const saveCart = useMutation({
    mutationFn: async (charge: boolean) => {
      if (!orgId || !ownerId) throw new Error("Select an owner first");
      if (items.length === 0) throw new Error("Cart is empty");

      // Upsert cart
      const cartPayload = {
        organization_id: orgId, owner_id: ownerId,
        cashier_user_id: user?.id ?? null,
        status: charge ? "charged" : "open",
        notes: notes || null,
        promotion_id: appliedPromo?.id ?? null,
        applied_store_credit_cents: charge ? totals.creditCents : 0,
        subtotal_cents: totals.subtotal, discount_cents: totals.discount,
        tax_cents: totals.tax, total_cents: totals.total,
        charged_at: charge ? new Date().toISOString() : null,
      };

      let cartId = cartIdFromUrl;
      if (cartId) {
        const { error } = await supabase.from("pos_carts").update(cartPayload).eq("id", cartId);
        if (error) throw error;
        await supabase.from("pos_cart_items").delete().eq("cart_id", cartId);
      } else {
        const { data, error } = await supabase.from("pos_carts").insert(cartPayload).select("id").single();
        if (error) throw error;
        cartId = data.id;
      }

      const itemRows = items.map((i) => ({
        organization_id: orgId, cart_id: cartId!, item_kind: i.item_kind,
        service_id: i.service_id, product_id: i.product_id, package_id: i.package_id,
        name: i.name, quantity: i.quantity,
        unit_price_cents: i.unit_price_cents, line_total_cents: i.line_total_cents,
      }));
      if (itemRows.length) {
        const { error } = await supabase.from("pos_cart_items").insert(itemRows);
        if (error) throw error;
      }

      if (!charge) return { cartId, invoiceId: null };

      // ========= Charge: create invoice + payment, decrement stock, decrement store credit, bump promo usage =========
      const { data: org } = await supabase.from("organizations").select("currency").eq("id", orgId).maybeSingle();
      const currency = (org?.currency ?? "CAD") as "CAD" | "USD";
      const invoiceNumber = await nextInvoiceNumber(orgId);
      const now = new Date().toISOString();

      const { data: inv, error: invErr } = await supabase.from("invoices").insert({
        organization_id: orgId, owner_id: ownerId,
        location_id: locationId ?? null,
        currency, status: "paid",
        issued_at: now, paid_at: now,
        invoice_number: invoiceNumber,
        subtotal_cents: totals.subtotal,
        tax_cents: totals.tax,
        surcharge_cents: totals.surcharge,
        total_cents: totals.total,
        amount_paid_cents: totals.total,
        cashier_user_id: user?.id ?? null,
        store_credit_applied_cents: totals.creditCents,
        promotion_discount_cents: totals.discount,
        promotion_id: appliedPromo?.id ?? null,
        notes: notes || null,
      }).select("id").single();
      if (invErr) throw invErr;

      // Lines
      const lineRows: any[] = items.map((i) => ({
        organization_id: orgId, invoice_id: inv.id,
        service_id: i.service_id,
        description: i.name, quantity: i.quantity,
        unit_price_cents: i.unit_price_cents,
        line_total_cents: i.line_total_cents,
        line_type: "item",
      }));
      if (totals.surcharge > 0) {
        lineRows.push({
          organization_id: orgId,
          invoice_id: inv.id,
          service_id: null,
          description: "Credit-card surcharge",
          quantity: 1,
          unit_price_cents: totals.surcharge,
          line_total_cents: totals.surcharge,
          line_type: "surcharge",
        });
      }
      await supabase.from("invoice_lines").insert(lineRows);

      // Payment row (map UI methods to DB enum: card / card_on_file -> card, cash/check/other -> in_person)
      if (totals.total > 0) {
        const dbMethod: "card" | "in_person" =
          paymentMethod === "card" || paymentMethod === "card_debit" || paymentMethod === "card_on_file"
            ? "card"
            : "in_person";
        await supabase.from("payments").insert({
          organization_id: orgId!, invoice_id: inv.id,
          amount_cents: totals.total, currency,
          method: dbMethod,
          status: "succeeded", processed_at: now,
        });
      }

      // Decrement stock for products
      for (const i of items) {
        if (i.item_kind === "product" && i.product_id) {
          await supabase.rpc("decrement_product_stock", {
            _product_id: i.product_id, _quantity: i.quantity, _allow_negative: false,
          });
        }
      }

      // Decrement store credit
      if (totals.creditCents > 0 && selectedOwner) {
        await supabase.from("owners").update({
          store_credit_cents: Math.max(0, (selectedOwner.store_credit_cents ?? 0) - totals.creditCents),
        }).eq("id", ownerId);
      }

      // Bump promo usage
      if (appliedPromo?.id) {
        await supabase.from("promotions").update({
          usage_count: (appliedPromo.usage_count ?? 0) + 1,
        }).eq("id", appliedPromo.id);
      }

      // Link invoice on cart
      await supabase.from("pos_carts").update({ invoice_id: inv.id }).eq("id", cartId!);

      const { logActivity } = await import("@/lib/activity");
      await logActivity({
        organization_id: orgId!,
        action: "pos_sale",
        entity_type: "invoice",
        entity_id: inv.id,
        metadata: {
          invoice_number: invoiceNumber,
          total_cents: totals.total,
          method: paymentMethod,
          item_count: items.length,
        },
      });

      return { cartId, invoiceId: inv.id };
    },
    onSuccess: (r, charge) => {
      qc.invalidateQueries({ queryKey: ["pos-open-carts"] });
      qc.invalidateQueries({ queryKey: ["pos-closed-invoices"] });
      qc.invalidateQueries({ queryKey: ["retail-products"] });
      if (charge) {
        toast.success("Sale completed");
        if (r.invoiceId) navigate(`/invoices/${r.invoiceId}`);
        else navigate("/pos/closed-invoices");
      } else {
        toast.success("Saved as open invoice");
        navigate("/pos/open-invoices");
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader title="Shopping Cart" description="Ring up a sale for a customer" />

        <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
          {/* LEFT: catalog + items */}
          <div className="space-y-6">
            {/* Owner picker */}
            <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
              <Label className="text-xs">Customer *</Label>
              {selectedOwner ? (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-md bg-background p-3">
                  <div>
                    <div className="font-medium text-foreground">{selectedOwner.first_name} {selectedOwner.last_name}</div>
                    <div className="text-xs text-text-tertiary">{selectedOwner.email ?? ""}</div>
                    <div className="mt-1 text-xs text-text-secondary">
                      Store credit: <span className="font-semibold text-foreground">{formatCentsShort(selectedOwner.store_credit_cents ?? 0)}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setOwnerId(null); setOwnerSearch(""); }}>
                    <X className="h-3.5 w-3.5" /> Change
                  </Button>
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
                    <Input value={ownerSearch} onChange={(e) => setOwnerSearch(e.target.value)} placeholder="Search by name or email…" className="pl-9" />
                  </div>
                  {owners.length > 0 && (
                    <div className="rounded-md border border-border-subtle bg-background divide-y divide-border-subtle max-h-60 overflow-y-auto">
                      {owners.map((o: any) => (
                        <button key={o.id} onClick={() => setOwnerId(o.id)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-card-alt">
                          <div className="font-medium text-foreground">{o.first_name} {o.last_name}</div>
                          <div className="text-xs text-text-tertiary">{o.email ?? ""}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Catalog */}
            <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
              <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
                <TabsList>
                  <TabsTrigger value="products">Products</TabsTrigger>
                  <TabsTrigger value="services">Services</TabsTrigger>
                  <TabsTrigger value="packages">Packages</TabsTrigger>
                </TabsList>
                <TabsContent value="products" className="mt-4">
                  <CatalogGrid
                    items={products.map((p: any) => ({ ...p, sub: `Stock: ${p.stock_quantity}` }))}
                    onAdd={(p) => addItem("product", p)}
                  />
                </TabsContent>
                <TabsContent value="services" className="mt-4">
                  <CatalogGrid
                    items={services.map((s: any) => ({ ...s, price_cents: s.base_price_cents, sub: s.module }))}
                    onAdd={(s) => addItem("service", s)}
                  />
                </TabsContent>
                <TabsContent value="packages" className="mt-4">
                  <CatalogGrid
                    items={packages.map((p: any) => ({ ...p, sub: p.validity_days ? `Valid ${p.validity_days} days` : "No expiry" }))}
                    onAdd={(p) => addItem("package", p)}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </div>

          {/* RIGHT: cart + checkout */}
          <div className="rounded-lg border border-border bg-surface p-5 shadow-card h-fit sticky top-4">
            <div className="flex items-center gap-2 mb-4">
              <ShoppingCart className="h-4 w-4 text-text-tertiary" />
              <div className="font-display text-base">Cart</div>
              {items.length > 0 && <Badge variant="outline" className="ml-auto">{items.length} items</Badge>}
            </div>
            {items.length === 0 ? (
              <div className="py-8 text-center text-sm text-text-tertiary">Cart is empty</div>
            ) : (
              <div className="space-y-2 mb-4 max-h-72 overflow-y-auto">
                {items.map((i) => (
                  <div key={i.id} className="flex items-start gap-2 rounded-md bg-background p-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{i.name}</div>
                      <div className="text-xs text-text-tertiary">{formatCentsShort(i.unit_price_cents)} × {i.quantity}</div>
                    </div>
                    <Input className="w-14 h-7 text-xs" inputMode="numeric"
                      value={i.quantity}
                      onChange={(e) => updateQty(i.id, parseInt(e.target.value) || 1)} />
                    <div className="text-sm font-medium w-16 text-right">{formatCentsShort(i.line_total_cents)}</div>
                    <Button variant="ghost" size="sm" onClick={() => removeItem(i.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Promo */}
            <div className="mb-3">
              <Label className="text-xs">Promo code</Label>
              <div className="flex gap-2 mt-1">
                <Input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="CODE" />
                <Button variant="outline" size="sm" onClick={applyPromo}>Apply</Button>
              </div>
              {appliedPromo && (
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="outline" className="border-success text-success">{appliedPromo.code}</Badge>
                  <button onClick={() => { setAppliedPromo(null); setPromoCode(""); }} className="text-xs text-text-tertiary hover:text-foreground">Remove</button>
                </div>
              )}
            </div>

            {/* Store credit */}
            {selectedOwner && (selectedOwner.store_credit_cents ?? 0) > 0 && (
              <div className="mb-3">
                <Label className="text-xs">Apply store credit ($)</Label>
                <Input inputMode="decimal" value={storeCreditInput}
                  onChange={(e) => setStoreCreditInput(e.target.value)} className="mt-1" />
                <div className="text-[11px] text-text-tertiary mt-1">
                  Available: {formatCentsShort(selectedOwner.store_credit_cents ?? 0)}
                </div>
              </div>
            )}

            {/* Totals */}
            <div className="space-y-1.5 border-t border-border-subtle pt-3 text-sm">
              <Row label="Subtotal" value={formatCentsShort(totals.subtotal)} />
              {totals.discount > 0 && <Row label="Discount" value={`−${formatCentsShort(totals.discount)}`} />}
              <Row label="Tax" value={formatCentsShort(totals.tax)} />
              {totals.creditCents > 0 && <Row label="Store credit" value={`−${formatCentsShort(totals.creditCents)}`} />}
              {totals.surcharge > 0 && (
                <Row
                  label={`Surcharge (${(surchargeSettings.rate_basis_points / 100).toFixed(1)}%)`}
                  value={formatCentsShort(totals.surcharge)}
                />
              )}
              <div className="flex justify-between pt-2 border-t border-border-subtle">
                <span className="font-display text-base">Total</span>
                <span className="font-display text-base font-semibold">{formatCentsShort(totals.total)}</span>
              </div>
              {surchargeSettings.enabled && surchargeSettings.customer_notice_text && totals.surcharge > 0 && (
                <p className="pt-1 text-[11px] text-text-tertiary">
                  {surchargeSettings.customer_notice_text}
                </p>
              )}
            </div>

            {/* Payment method */}
            <div className="mt-3">
              <Label className="text-xs">Payment method</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as any)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {defaultCard && (
                    <SelectItem value="card_on_file">
                      Card on file ({defaultCard.card_brand} •••• {defaultCard.card_last_four})
                    </SelectItem>
                  )}
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="card">Credit card (recorded)</SelectItem>
                  <SelectItem value="card_debit">Debit card (recorded)</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              {paymentMethod === "card_on_file" && (
                <p className="mt-1 text-[11px] text-text-tertiary">
                  Will be recorded as paid. Stripe charge will run when integrated.
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="mt-3">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
            </div>

            {/* Actions */}
            <div className="mt-4 grid gap-2">
              <Button onClick={() => saveCart.mutate(true)} disabled={saveCart.isPending || !ownerId || items.length === 0}>
                <CreditCard className="h-4 w-4" /> Charge {formatCentsShort(totals.total)}
              </Button>
              <Button variant="outline" onClick={() => saveCart.mutate(false)} disabled={saveCart.isPending || !ownerId || items.length === 0}>
                <Save className="h-4 w-4" /> Save as Open Invoice
              </Button>
            </div>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-text-secondary">
      <span>{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function CatalogGrid({ items, onAdd }: { items: any[]; onAdd: (i: any) => void }) {
  if (items.length === 0) return <div className="py-8 text-center text-sm text-text-tertiary">No items available</div>;
  return (
    <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
      {items.map((i) => (
        <button key={i.id} onClick={() => onAdd(i)}
          className="text-left rounded-md border border-border-subtle bg-background p-3 hover:border-accent hover:bg-card-alt transition-colors">
          <div className="text-sm font-medium text-foreground line-clamp-1">{i.name}</div>
          <div className="text-xs text-text-tertiary">{i.sub}</div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-sm font-semibold">{formatCentsShort(i.price_cents ?? i.base_price_cents ?? 0)}</span>
            <Plus className="h-3.5 w-3.5 text-accent" />
          </div>
        </button>
      ))}
    </div>
  );
}
