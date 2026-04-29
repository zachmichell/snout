import { useSearchParams } from "react-router-dom";
import { Package } from "lucide-react";
import { Link } from "react-router-dom";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PosProductsSection } from "../pos/PosProducts";
import { PosPromotionsSection } from "../pos/PosPromotions";

const VALID = ["products", "packages", "promotions"] as const;
type Tab = (typeof VALID)[number];

export default function Products() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = (VALID as readonly string[]).includes(raw ?? "")
    ? (raw as Tab)
    : "products";

  const setTab = (next: string) => {
    const p = new URLSearchParams(params);
    if (next === "products") p.delete("tab");
    else p.set("tab", next);
    setParams(p, { replace: true });
  };

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Products"
          description="Retail products, service packages, and discount codes"
        />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="products">Products</TabsTrigger>
            <TabsTrigger value="packages">Packages</TabsTrigger>
            <TabsTrigger value="promotions">Promotions</TabsTrigger>
          </TabsList>
          <TabsContent value="products" className="mt-4">
            <PosProductsSection showHeader={false} />
          </TabsContent>
          <TabsContent value="packages" className="mt-4">
            <EmptyState
              icon={Package}
              title="Manage packages in Subscriptions"
              description="Packages share data with subscription packages — one source of truth."
              action={
                <Button asChild>
                  <Link to="/subscriptions">Open Packages</Link>
                </Button>
              }
            />
          </TabsContent>
          <TabsContent value="promotions" className="mt-4">
            <PosPromotionsSection showHeader={false} />
          </TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  );
}
