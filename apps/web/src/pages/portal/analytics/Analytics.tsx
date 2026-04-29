import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CalendarIcon } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { getDateRange, RangePreset } from "@/lib/analytics";
import { format } from "date-fns";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLocationFilter } from "@/contexts/LocationContext";
import RevenueTab from "./tabs/RevenueTab";
import OccupancyTab from "./tabs/OccupancyTab";
import ClientsTab from "./tabs/ClientsTab";
import PetsTab from "./tabs/PetsTab";
import CustomReportsTab from "./tabs/CustomReportsTab";

function useOrgCurrency() {
  const { membership } = useAuth();
  return useQuery({
    enabled: !!membership?.organization_id,
    queryKey: ["org-currency", membership?.organization_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("currency")
        .eq("id", membership!.organization_id)
        .maybeSingle();
      return (data?.currency as string) ?? "CAD";
    },
  });
}

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "This Week" },
  { value: "30d", label: "Last 30 Days" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "custom", label: "Custom Range" },
];

export default function Analytics() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [tab, setTab] = useState("revenue");
  const locationId = useLocationFilter();

  const range = useMemo(
    () =>
      getDateRange(
        preset,
        preset === "custom" && customFrom && customTo
          ? { from: customFrom, to: customTo }
          : undefined,
      ),
    [preset, customFrom, customTo],
  );

  const { data: analyticsData } = useAnalytics(range, locationId);
  const { data: currency = "CAD" } = useOrgCurrency();

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Analytics"
          description="Insights across revenue, occupancy, clients, and pets"
          actions={
            <div className="flex items-center gap-2">
              <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {preset === "custom" && (
                <>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <CalendarIcon className="h-4 w-4" />
                        {customFrom ? format(customFrom, "MMM d") : "From"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <Calendar
                        mode="single"
                        selected={customFrom}
                        onSelect={setCustomFrom}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <CalendarIcon className="h-4 w-4" />
                        {customTo ? format(customTo, "MMM d") : "To"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <Calendar
                        mode="single"
                        selected={customTo}
                        onSelect={setCustomTo}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </>
              )}
            </div>
          }
        />

        <Tabs value={tab} onValueChange={setTab} className="mt-2">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="occupancy">Occupancy</TabsTrigger>
            <TabsTrigger value="clients">Clients</TabsTrigger>
            <TabsTrigger value="pets">Pets</TabsTrigger>
            <TabsTrigger value="custom">Custom Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="revenue" className="mt-6">
            <RevenueTab data={analyticsData} range={range} currency={currency} />
          </TabsContent>
          <TabsContent value="occupancy" className="mt-6">
            <OccupancyTab data={analyticsData} range={range} />
          </TabsContent>
          <TabsContent value="clients" className="mt-6">
            <ClientsTab range={range} currency={currency} />
          </TabsContent>
          <TabsContent value="pets" className="mt-6">
            <PetsTab range={range} />
          </TabsContent>
          <TabsContent value="custom" className="mt-6">
            <CustomReportsTab range={range} />
          </TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  );
}
