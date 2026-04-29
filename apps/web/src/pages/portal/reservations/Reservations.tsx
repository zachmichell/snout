import { useSearchParams } from "react-router-dom";
import PortalLayout from "@/components/portal/PortalLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ReservationsListSection } from "./ReservationsList";
import { StandingReservationsSection } from "./StandingReservations";

export default function Reservations() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "standing" ? "standing" : "all";

  const setTab = (next: string) => {
    const p = new URLSearchParams(params);
    if (next === "all") p.delete("tab");
    else p.set("tab", next);
    setParams(p, { replace: true });
  };

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <Tabs value={tab} onValueChange={setTab} className="mb-4">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="standing">Standing</TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="mt-4">
            <ReservationsListSection />
          </TabsContent>
          <TabsContent value="standing" className="mt-4">
            <StandingReservationsSection showHeader={false} />
          </TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  );
}
