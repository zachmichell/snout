import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import OrganizationTab from "./OrganizationTab";
import LocationsTab from "./LocationsTab";
import TeamTab from "./TeamTab";
import SubscriptionTab from "./SubscriptionTab";
import PaymentsTab from "./PaymentsTab";
import BillingTab from "./BillingTab";
import EmailTab from "./EmailTab";
import MessageTemplatesTab from "./MessageTemplatesTab";
import SurchargeTab from "./SurchargeTab";
import DepositsTab from "./DepositsTab";
import { PlaygroupsSection } from "../playgroups/Playgroups";
import { KennelRunsSection } from "../kennel-runs/KennelRuns";
import { SuiteManagementSection } from "../facility/SuiteManagement";
import { GroomerManagementSection } from "../facility/GroomerManagement";
import SettingsTraitsTab from "./TraitsTab";
import StaffCodesTab from "./StaffCodesTab";
import ImportWizard from "./import/ImportWizard";
import ChangelogTab from "./ChangelogTab";
import WebcamsTab from "./WebcamsTab";
import QuickBooksTab from "./QuickBooksTab";
import SettingsHistoryTab from "./SettingsHistoryTab";
import { usePermissions } from "@/hooks/usePermissions";
import type { Permission } from "@/lib/permissions";

const TAB_CONFIG: Array<{ key: string; label: string; permission: Permission }> = [
  { key: "organization", label: "Organization", permission: "settings.organization" },
  { key: "locations", label: "Locations", permission: "settings.locations" },
  { key: "team", label: "Team", permission: "settings.team" },
  { key: "staff-codes", label: "Staff Codes", permission: "settings.team" },
  { key: "payments", label: "Payments", permission: "settings.payments" },
  { key: "deposits", label: "Deposits", permission: "settings.payments" },
  { key: "surcharge", label: "Surcharge", permission: "settings.payments" },
  { key: "billing", label: "Billing", permission: "settings.billing" },
  { key: "email", label: "Email", permission: "settings.email" },
  { key: "templates", label: "Templates", permission: "settings.email" },
  { key: "subscription", label: "Subscription", permission: "settings.subscription" },
  { key: "playgroups", label: "Playgroups", permission: "playgroups.manage" },
  { key: "kennel-runs", label: "Kennel Runs", permission: "kennels.manage" },
  { key: "suites", label: "Suites", permission: "settings.organization" },
  { key: "groomers", label: "Groomers", permission: "settings.organization" },
  { key: "traits", label: "Traits", permission: "settings.organization" },
  { key: "import", label: "Import", permission: "settings.organization" },
  { key: "changelog", label: "Changelog", permission: "settings.organization" },
  { key: "webcams", label: "Webcams", permission: "settings.organization" },
  { key: "quickbooks", label: "QuickBooks", permission: "settings.billing" },
  { key: "history", label: "History", permission: "settings.organization" },
];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const { can } = usePermissions();

  const visible = TAB_CONFIG.filter((t) => can(t.permission));
  const visibleKeys = visible.map((t) => t.key);
  const raw = params.get("tab");
  const active = raw && visibleKeys.includes(raw) ? raw : visibleKeys[0] ?? "";

  useEffect(() => {
    if (raw && !visibleKeys.includes(raw) && visibleKeys.length > 0) {
      const next = new URLSearchParams(params);
      next.set("tab", visibleKeys[0]);
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, visibleKeys.join(",")]);

  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", t);
    setParams(next, { replace: true });
  };

  if (visible.length === 0) {
    return (
      <PortalLayout>
        <PageHeader title="Settings" description="Manage your organization" />
        <p className="text-sm text-muted-foreground">No settings available for your role.</p>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <PageHeader title="Settings" description="Manage your organization" />
      <Tabs value={active} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          {visible.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {can("settings.organization") && (
          <TabsContent value="organization" className="mt-6">
            <OrganizationTab />
          </TabsContent>
        )}
        {can("settings.locations") && (
          <TabsContent value="locations" className="mt-6">
            <LocationsTab />
          </TabsContent>
        )}
        {can("settings.team") && (
          <TabsContent value="team" className="mt-6">
            <TeamTab />
          </TabsContent>
        )}
        {can("settings.team") && (
          <TabsContent value="staff-codes" className="mt-6">
            <StaffCodesTab />
          </TabsContent>
        )}
        {can("settings.payments") && (
          <TabsContent value="payments" className="mt-6">
            <PaymentsTab />
          </TabsContent>
        )}
        {can("settings.payments") && (
          <TabsContent value="deposits" className="mt-6">
            <DepositsTab />
          </TabsContent>
        )}
        {can("settings.payments") && (
          <TabsContent value="surcharge" className="mt-6">
            <SurchargeTab />
          </TabsContent>
        )}
        {can("settings.billing") && (
          <TabsContent value="billing" className="mt-6">
            <BillingTab />
          </TabsContent>
        )}
        {can("settings.email") && (
          <TabsContent value="email" className="mt-6">
            <EmailTab />
          </TabsContent>
        )}
        {can("settings.email") && (
          <TabsContent value="templates" className="mt-6">
            <MessageTemplatesTab />
          </TabsContent>
        )}
        {can("settings.subscription") && (
          <TabsContent value="subscription" className="mt-6">
            <SubscriptionTab />
          </TabsContent>
        )}
        {can("playgroups.manage") && (
          <TabsContent value="playgroups" className="mt-6">
            <PlaygroupsSection />
          </TabsContent>
        )}
        {can("kennels.manage") && (
          <TabsContent value="kennel-runs" className="mt-6">
            <KennelRunsSection />
          </TabsContent>
        )}
        {can("settings.organization") && (
          <TabsContent value="suites" className="mt-6">
            <SuiteManagementSection />
          </TabsContent>
        )}
        {can("settings.organization") && (
          <TabsContent value="groomers" className="mt-6">
            <GroomerManagementSection />
          </TabsContent>
        )}
        {can("settings.organization") && (
          <TabsContent value="traits" className="mt-6">
            <SettingsTraitsTab />
          </TabsContent>
        )}
        {can("settings.organization") && (
          <TabsContent value="import" className="mt-6">
            <ImportWizard />
          </TabsContent>
        )}
        {can("settings.organization") && (
          <TabsContent value="changelog" className="mt-6">
            <ChangelogTab />
          </TabsContent>
        )}
        {can("settings.organization") && (
          <TabsContent value="webcams" className="mt-6">
            <WebcamsTab />
          </TabsContent>
        )}
        {can("settings.billing") && (
          <TabsContent value="quickbooks" className="mt-6">
            <QuickBooksTab />
          </TabsContent>
        )}
        {can("settings.organization") && (
          <TabsContent value="history" className="mt-6">
            <SettingsHistoryTab />
          </TabsContent>
        )}
      </Tabs>
    </PortalLayout>
  );
}
