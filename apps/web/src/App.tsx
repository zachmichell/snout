import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import RoleRoute from "@/components/auth/RoleRoute";
import RequirePermission from "@/components/auth/RequirePermission";
import OwnerPortalLayout from "@/components/portal-owner/OwnerPortalLayout";
import { LocationProvider } from "@/contexts/LocationContext";
import { StaffCodeProvider } from "@/contexts/StaffCodeContext";
import type { Permission } from "@/lib/permissions";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import Onboarding from "./pages/onboarding/Onboarding";
import HelcimCheckout from "./pages/pay/HelcimCheckout";
import Dashboard from "./pages/portal/Dashboard";
import OwnersList from "./pages/portal/owners/OwnersList";
import OwnerForm from "./pages/portal/owners/OwnerForm";
import OwnerDetail from "./pages/portal/owners/OwnerDetail";
import PetsList from "./pages/portal/pets/PetsList";
import PetForm from "./pages/portal/pets/PetForm";
import PetDetail from "./pages/portal/pets/PetDetail";
import ServicesList from "./pages/portal/services/ServicesList";
import ServiceForm from "./pages/portal/services/ServiceForm";
import ServiceDetail from "./pages/portal/services/ServiceDetail";
import ReservationsList from "./pages/portal/reservations/ReservationsList";
import Reservations from "./pages/portal/reservations/Reservations";
import ReservationForm from "./pages/portal/reservations/ReservationForm";
import ReservationDetail from "./pages/portal/reservations/ReservationDetail";
import ReservationEdit from "./pages/portal/reservations/ReservationEdit";
import StandingReservations from "./pages/portal/reservations/StandingReservations";
import Schedule from "./pages/portal/schedule/Schedule";

import Analytics from "./pages/portal/analytics/Analytics";
import Reports from "./pages/portal/reports/Reports";
import Invoices from "./pages/portal/invoices/Invoices";
import InvoicesList from "./pages/portal/invoices/InvoicesList";
import InvoiceDetail from "./pages/portal/invoices/InvoiceDetail";
import Settings from "./pages/portal/settings/Settings";
import Playgroups from "./pages/portal/playgroups/Playgroups";
import KennelRuns from "./pages/portal/kennel-runs/KennelRuns";
import CareLogs from "./pages/portal/care-logs/CareLogs";
import IncidentsList from "./pages/portal/incidents/IncidentsList";
import IncidentForm from "./pages/portal/incidents/IncidentForm";
import IncidentDetail from "./pages/portal/incidents/IncidentDetail";
import StaffMessages from "./pages/portal/messages/Messages";
import OwnerMessages from "./pages/portal-owner/Messages";
import OwnerReportCards from "./pages/portal-owner/ReportCards";
import OwnerWebcams from "./pages/portal-owner/Webcams";
import OwnerReportCardDetail from "./pages/portal-owner/ReportCardDetail";
import OwnerDashboard from "./pages/portal-owner/Dashboard";
import OwnerAccount from "./pages/portal-owner/Account";
import OwnerComingSoon from "./pages/portal-owner/ComingSoon";
import OwnerPets from "./pages/portal-owner/Pets";
import OwnerPetDetail from "./pages/portal-owner/PetDetail";
import OwnerBookings from "./pages/portal-owner/Bookings";
import OwnerInvoices from "./pages/portal-owner/Invoices";
import OwnerInvoiceDetail from "./pages/portal-owner/InvoiceDetail";
import OwnerWaivers from "./pages/portal-owner/Waivers";
import OwnerWaiverDetail from "./pages/portal-owner/WaiverDetail";
import OwnerPurchases from "./pages/portal-owner/Purchases";
import OwnerServiceHistory from "./pages/portal-owner/ServiceHistory";
import Lodging from "./pages/portal/lodging/Lodging";
import Grooming from "./pages/portal/grooming/Grooming";
import SuiteManagement from "./pages/portal/facility/SuiteManagement";
import GroomerManagement from "./pages/portal/facility/GroomerManagement";
import ReportCardsList from "./pages/portal/pet-care/ReportCardsList";
import Traits from "./pages/portal/pet-care/Traits";
import PetCare from "./pages/portal/pet-care/PetCare";
import UserManagement from "./pages/portal/management/UserManagement";

import ServiceTypes from "./pages/portal/management/ServiceTypes";
import Subscriptions from "./pages/portal/settings/Subscriptions";
import Marketing from "./pages/portal/settings/Marketing";
import SmsComms from "./pages/portal/settings/SmsComms";
import LocationsPage from "./pages/portal/settings/LocationsPage";
import PosCart from "./pages/portal/pos/PosCart";
import PosProducts from "./pages/portal/pos/PosProducts";
import PosPackages from "./pages/portal/pos/PosPackages";
import PosPromotions from "./pages/portal/pos/PosPromotions";
import PosOpenInvoices from "./pages/portal/pos/PosOpenInvoices";
import PosClosedInvoices from "./pages/portal/pos/PosClosedInvoices";
import Products from "./pages/portal/products/Products";
import DataImport from "./pages/portal/settings/DataImport";
import DataMerge from "./pages/portal/settings/DataMerge";
import AuditLog from "./pages/portal/settings/AuditLog";
import GroupClasses from "./pages/portal/group-classes/GroupClasses";
import OwnerClasses from "./pages/portal-owner/Classes";
import Deposits from "./pages/portal/deposits/Deposits";
import AgreementTemplates from "./pages/portal/agreements/AgreementTemplates";
import AgreementTracking from "./pages/portal/agreements/AgreementTracking";
import OwnerAgreements from "./pages/portal-owner/Agreements";
import CheckInOut from "./pages/portal/check-in-out/CheckInOut";

const queryClient = new QueryClient();

const staff = (el: React.ReactNode, permission?: Permission) => (
  <ProtectedRoute>
    <RoleRoute allow="staff">
      <LocationProvider>
        <StaffCodeProvider>
          {permission ? <RequirePermission permission={permission}>{el}</RequirePermission> : el}
        </StaffCodeProvider>
      </LocationProvider>
    </RoleRoute>
  </ProtectedRoute>
);

const customer = (el: React.ReactNode) => (
  <ProtectedRoute>
    <RoleRoute allow="customer">
      <OwnerPortalLayout>{el}</OwnerPortalLayout>
    </RoleRoute>
  </ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            {/* Public Helcim checkout — used by pet owners following an invoice link.
                No auth required; the checkoutToken in the URL gates payment ability. */}
            <Route path="/pay/helcim/:invoiceId" element={<HelcimCheckout />} />
            <Route
              path="/onboarding"
              element={
                <ProtectedRoute requireOrg={false}>
                  <Onboarding />
                </ProtectedRoute>
              }
            />

            {/* Staff portal */}
            <Route path="/dashboard" element={staff(<Dashboard />)} />
            <Route path="/calendar" element={staff(<Schedule />)} />
            <Route path="/schedule" element={<Navigate to="/calendar" replace />} />
            <Route path="/lodging" element={staff(<Lodging />)} />
            <Route path="/grooming" element={staff(<Grooming />)} />
            <Route path="/suite-management" element={<Navigate to="/settings?tab=suites" replace />} />
            <Route path="/groomer-management" element={<Navigate to="/settings?tab=groomers" replace />} />
            <Route path="/report-cards" element={staff(<ReportCardsList />)} />
            <Route path="/traits" element={staff(<Traits />)} />
            <Route path="/pet-care" element={staff(<PetCare />)} />
            <Route path="/user-management" element={staff(<UserManagement />)} />
            <Route path="/staff-codes" element={<Navigate to="/settings?tab=staff-codes" replace />} />
            <Route path="/service-types" element={staff(<ServiceTypes />)} />
            <Route path="/subscriptions" element={staff(<Subscriptions />)} />
            <Route path="/marketing" element={staff(<Marketing />)} />
            <Route path="/sms-comms" element={staff(<SmsComms />)} />
            <Route path="/pets" element={staff(<PetsList />)} />
            <Route path="/pets/new" element={staff(<PetForm />)} />
            <Route path="/pets/:id" element={staff(<PetDetail />)} />
            <Route path="/pets/:id/edit" element={staff(<PetForm />)} />
            <Route path="/owners" element={staff(<OwnersList />)} />
            <Route path="/owners/new" element={staff(<OwnerForm />)} />
            <Route path="/owners/:id" element={staff(<OwnerDetail />)} />
            <Route path="/owners/:id/edit" element={staff(<OwnerForm />)} />
            <Route path="/services" element={staff(<ServicesList />, "services.manage")} />
            <Route path="/services/new" element={staff(<ServiceForm />, "services.manage")} />
            <Route path="/services/:id" element={staff(<ServiceDetail />, "services.manage")} />
            <Route path="/services/:id/edit" element={staff(<ServiceForm />, "services.manage")} />
            <Route path="/reservations" element={staff(<Reservations />)} />
            <Route path="/reservations/new" element={staff(<ReservationForm />, "reservations.create")} />
            <Route path="/reservations/:id" element={staff(<ReservationDetail />)} />
            <Route path="/reservations/:id/edit" element={staff(<ReservationEdit />, "reservations.edit")} />
            <Route path="/standing-reservations" element={<Navigate to="/reservations?tab=standing" replace />} />
            <Route path="/group-classes" element={staff(<GroupClasses />)} />
            <Route path="/invoices" element={staff(<Invoices />, "invoices.view")} />
            <Route path="/invoices/list" element={staff(<InvoicesList />, "invoices.view")} />
            <Route path="/invoices/:id" element={staff(<InvoiceDetail />, "invoices.view")} />
            <Route path="/check-in-out" element={staff(<CheckInOut />)} />
            <Route path="/dashboard/check-in-out" element={<Navigate to="/check-in-out" replace />} />
            <Route path="/dashboard/analytics" element={<Navigate to="/analytics" replace />} />
            <Route path="/analytics" element={staff(<Analytics />, "revenue.view")} />
            <Route path="/reports" element={staff(<Reports />, "analytics.view")} />
            <Route path="/care-logs" element={staff(<CareLogs />, "carelogs.create")} />
            <Route path="/messages" element={staff(<StaffMessages />, "messaging.send")} />
            <Route path="/incidents" element={staff(<IncidentsList />)} />
            <Route path="/incidents/new" element={staff(<IncidentForm />, "incidents.create")} />
            <Route path="/incidents/:id" element={staff(<IncidentDetail />)} />
            <Route path="/incidents/:id/edit" element={staff(<IncidentForm />, "incidents.edit")} />
            <Route path="/playgroups" element={<Navigate to="/settings?tab=playgroups" replace />} />
            <Route path="/kennel-runs" element={<Navigate to="/settings?tab=kennel-runs" replace />} />
            <Route path="/settings/locations" element={staff(<LocationsPage />, "settings.locations")} />
            <Route path="/settings/data-import" element={staff(<DataImport />, "data.import")} />
            <Route path="/settings/data-merge" element={staff(<DataMerge />, "data.merge")} />
            <Route path="/settings/audit-log" element={staff(<AuditLog />, "audit.view")} />
            <Route path="/pos/cart" element={staff(<PosCart />)} />
            <Route path="/products" element={staff(<Products />)} />
            <Route path="/pos/products" element={<Navigate to="/products" replace />} />
            <Route path="/pos/packages" element={<Navigate to="/products?tab=packages" replace />} />
            <Route path="/pos/promotions" element={<Navigate to="/products?tab=promotions" replace />} />
            <Route path="/pos/open-invoices" element={<Navigate to="/invoices" replace />} />
            <Route path="/pos/closed-invoices" element={<Navigate to="/invoices?tab=closed" replace />} />
            <Route path="/settings" element={staff(<Settings />, "settings.view")} />
            <Route path="/deposits" element={staff(<Deposits />)} />
            <Route path="/agreements" element={staff(<AgreementTracking />)} />
            <Route path="/agreements/templates" element={staff(<AgreementTemplates />)} />

            {/* Owner portal */}
            <Route path="/portal/dashboard" element={customer(<OwnerDashboard />)} />
            <Route path="/portal/account" element={customer(<OwnerAccount />)} />
            <Route path="/portal/pets" element={customer(<OwnerPets />)} />
            <Route path="/portal/pets/:id" element={customer(<OwnerPetDetail />)} />
            <Route path="/portal/bookings" element={customer(<OwnerBookings />)} />
            <Route path="/portal/invoices" element={customer(<OwnerInvoices />)} />
            <Route path="/portal/invoices/:id" element={customer(<OwnerInvoiceDetail />)} />
            <Route path="/portal/waivers" element={customer(<OwnerWaivers />)} />
            <Route path="/portal/waivers/:id" element={customer(<OwnerWaiverDetail />)} />
            <Route path="/portal/report-cards" element={customer(<OwnerReportCards />)} />
            <Route path="/portal/report-cards/:id" element={customer(<OwnerReportCardDetail />)} />
            <Route path="/portal/messages" element={customer(<OwnerMessages />)} />
            <Route path="/portal/purchases" element={customer(<OwnerPurchases />)} />
            <Route path="/portal/history" element={customer(<OwnerServiceHistory />)} />
            <Route path="/portal/classes" element={customer(<OwnerClasses />)} />
            <Route path="/portal/agreements" element={customer(<OwnerAgreements />)} />
            <Route path="/portal/webcams" element={customer(<OwnerWebcams />)} />

            {/* Common URL-bar aliases — operators occasionally type
                short paths from memory or paste a link that uses an
                older slug. Catching these as redirects beats showing
                a 404. */}
            <Route path="/checkin" element={<Navigate to="/check-in-out" replace />} />
            <Route path="/check-in" element={<Navigate to="/check-in-out" replace />} />
            <Route path="/checkout" element={<Navigate to="/check-in-out" replace />} />
            <Route path="/check-out" element={<Navigate to="/check-in-out" replace />} />
            <Route path="/users" element={<Navigate to="/user-management" replace />} />
            <Route path="/team" element={<Navigate to="/settings?tab=team" replace />} />
            <Route path="/staff" element={<Navigate to="/user-management" replace />} />
            <Route path="/billing" element={<Navigate to="/settings?tab=billing" replace />} />
            <Route path="/payments" element={<Navigate to="/settings?tab=payments" replace />} />
            <Route path="/email" element={<Navigate to="/settings?tab=email" replace />} />
            <Route path="/templates" element={<Navigate to="/settings?tab=templates" replace />} />
            <Route path="/changelog" element={<Navigate to="/settings?tab=changelog" replace />} />
            <Route path="/webcams" element={<Navigate to="/settings?tab=webcams" replace />} />
            <Route path="/quickbooks" element={<Navigate to="/settings?tab=quickbooks" replace />} />
            <Route path="/coupons" element={<Navigate to="/products?tab=promotions" replace />} />
            <Route path="/promotions" element={<Navigate to="/products?tab=promotions" replace />} />
            <Route path="/packages" element={<Navigate to="/products?tab=packages" replace />} />
            <Route path="/products/all" element={<Navigate to="/products" replace />} />
            <Route path="/self-wash" element={<Navigate to="/settings?tab=self-wash-bays" replace />} />
            <Route path="/self-wash-bays" element={<Navigate to="/settings?tab=self-wash-bays" replace />} />
            <Route path="/locations" element={<Navigate to="/settings/locations" replace />} />
            <Route path="/audit-log" element={<Navigate to="/settings/audit-log" replace />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
