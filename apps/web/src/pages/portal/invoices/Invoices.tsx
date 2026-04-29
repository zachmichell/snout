import { useSearchParams } from "react-router-dom";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PosOpenInvoicesSection } from "../pos/PosOpenInvoices";
import { PosClosedInvoicesSection } from "../pos/PosClosedInvoices";

export default function Invoices() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "closed" ? "closed" : "open";

  const setTab = (next: string) => {
    const p = new URLSearchParams(params);
    if (next === "open") p.delete("tab");
    else p.set("tab", next);
    setParams(p, { replace: true });
  };

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader title="Invoices" description="Open carts and paid invoices" />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
          </TabsList>
          <TabsContent value="open" className="mt-4">
            <PosOpenInvoicesSection showHeader={false} />
          </TabsContent>
          <TabsContent value="closed" className="mt-4">
            <PosClosedInvoicesSection showHeader={false} />
          </TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  );
}
