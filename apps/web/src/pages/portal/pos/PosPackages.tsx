import { Package } from "lucide-react";
import { Link } from "react-router-dom";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import { Button } from "@/components/ui/button";

/**
 * POS Packages reuses the existing /subscriptions page (subscription_packages table).
 * This page is a redirect/pointer so the POS sidebar nav has somewhere to land.
 */
export default function PosPackages() {
  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader title="Packages" description="Service credit bundles sold at the POS" />
        <EmptyState
          icon={Package}
          title="Manage packages in Subscriptions"
          description="Packages are stored alongside subscription packages — one source of truth for credit bundles."
          action={
            <Button asChild>
              <Link to="/subscriptions">Open Packages</Link>
            </Button>
          }
        />
      </div>
    </PortalLayout>
  );
}
