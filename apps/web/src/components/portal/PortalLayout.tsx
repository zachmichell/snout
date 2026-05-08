import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import Sidebar from "./Sidebar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSubscriptionStatus } from "@/hooks/useSubscriptionStatus";
import PausedOverlay from "./billing/PausedOverlay";
import PastDueBanner from "./billing/PastDueBanner";
import PricingChangeBanner from "./billing/PricingChangeBanner";
import TrialBanner from "./billing/TrialBanner";
import SupportWidget from "./support/SupportWidget";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { membership } = useAuth();
  const [orgName, setOrgName] = useState<string | null>(null);
  const { data: sub } = useSubscriptionStatus();
  const location = useLocation();
  const [params] = useSearchParams();

  useEffect(() => {
    if (!membership) return;
    supabase
      .from("organizations")
      .select("name")
      .eq("id", membership.organization_id)
      .maybeSingle()
      .then(({ data }) => setOrgName(data?.name ?? null));
  }, [membership]);

  // Allow billing tab + auth routes when paused
  const isOnBillingTab =
    location.pathname.startsWith("/settings") && params.get("tab") === "billing";
  const isOnAuth = location.pathname.startsWith("/auth");
  const showPausedOverlay = sub?.isPaused && !isOnBillingTab && !isOnAuth;
  const showTrialBanner = sub?.isTrial && sub.trialDaysRemaining <= 7;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar orgName={orgName} />
      <main className="flex-1 overflow-y-auto">
        {sub?.isPastDue && <PastDueBanner />}
        {showTrialBanner && <TrialBanner daysRemaining={sub.trialDaysRemaining} />}
        <PricingChangeBanner />
        {children}
      </main>
      {showPausedOverlay && <PausedOverlay />}
      {/* Support widget — floats bottom-right on every staff portal page.
          Suppressed during the paused overlay since the operator can't
          interact with the rest of the UI anyway. */}
      {!showPausedOverlay && <SupportWidget />}
    </div>
  );
}
