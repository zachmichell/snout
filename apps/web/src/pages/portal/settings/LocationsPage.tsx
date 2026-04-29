import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import LocationsTab from "./LocationsTab";

export default function LocationsPage() {
  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Locations"
          description="Manage your business locations and operating hours."
        />
        <LocationsTab />
      </div>
    </PortalLayout>
  );
}
