import { useMemo, useState } from "react";
import { Receipt } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import InvoiceCard from "@/components/portal-owner/InvoiceCard";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { useOwnerInvoices } from "@/hooks/useOwnerInvoices";
import { isOverdueDisplay } from "@/lib/invoice";

type TabKey = "outstanding" | "paid" | "all";

export default function OwnerInvoices() {
  const { data: owner, isLoading: ownerLoading } = useOwnerRecord();
  const { data: invoices = [], isLoading } = useOwnerInvoices();
  const [tab, setTab] = useState<TabKey>("outstanding");

  const grouped = useMemo(() => {
    const sent = (invoices as any[]).filter((i) => i.status === "sent" || i.status === "overdue");
    const outstanding = [...sent].sort(
      (a, b) =>
        new Date(a.due_at ?? 0).getTime() - new Date(b.due_at ?? 0).getTime(),
    );
    const paid = (invoices as any[])
      .filter((i) => i.status === "paid")
      .sort(
        (a, b) =>
          new Date(b.issued_at ?? 0).getTime() - new Date(a.issued_at ?? 0).getTime(),
      );
    const all = [...(invoices as any[])].sort(
      (a, b) =>
        new Date(b.issued_at ?? 0).getTime() - new Date(a.issued_at ?? 0).getTime(),
    );
    return { outstanding, paid, all };
  }, [invoices]);

  if (!ownerLoading && !owner) {
    return (
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">My Invoices</h1>
        <div className="mt-8 rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
          <Receipt className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 text-lg font-medium text-foreground">Account setup in progress</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account isn't fully set up yet — please contact the business.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-foreground">My Invoices</h1>
        <p className="mt-2 text-base text-muted-foreground">View your billing history</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="bg-card-alt">
          <TabsTrigger value="outstanding">
            Outstanding {grouped.outstanding.length > 0 && `(${grouped.outstanding.length})`}
          </TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>

        {(["outstanding", "paid", "all"] as TabKey[]).map((key) => (
          <TabsContent key={key} value={key} className="mt-6">
            {isLoading ? (
              <div className="rounded-2xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : grouped[key].length === 0 ? (
              <EmptyState tab={key} />
            ) : (
              <ul className="space-y-4">
                {grouped[key].map((inv: any) => (
                  <li key={inv.id}>
                    <InvoiceCard invoice={inv} />
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function EmptyState({ tab }: { tab: TabKey }) {
  const text =
    tab === "outstanding"
      ? "You're all caught up — no outstanding invoices!"
      : tab === "paid"
        ? "No paid invoices yet."
        : "No invoices yet — you're all caught up!";
  return (
    <div className="rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
      <Receipt className="mx-auto h-10 w-10 text-muted-foreground" />
      <p className="mt-4 text-base text-foreground">{text}</p>
    </div>
  );
}
