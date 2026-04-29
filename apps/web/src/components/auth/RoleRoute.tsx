import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

type Allow = "staff" | "customer";

const STAFF_ROLES = ["owner", "admin", "manager", "staff"];

export default function RoleRoute({
  allow,
  children,
}: {
  allow: Allow;
  children: React.ReactNode;
}) {
  const { user, membership, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (!membership) return <Navigate to="/onboarding" replace />;

  const isCustomer = membership.role === "customer";
  const isStaff = STAFF_ROLES.includes(membership.role);

  if (allow === "staff" && !isStaff) {
    return <NotAuthorized intendedFor="staff" />;
  }
  if (allow === "customer" && !isCustomer) {
    return <NotAuthorized intendedFor="customer" />;
  }

  return <>{children}</>;
}

function NotAuthorized({ intendedFor }: { intendedFor: Allow }) {
  const target = intendedFor === "staff" ? "/portal/dashboard" : "/dashboard";
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="font-display text-2xl font-bold text-foreground">Not authorized</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You don't have access to this area. Head back to your portal to continue.
        </p>
        <a
          href={target}
          className="mt-6 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Go to my portal
        </a>
      </div>
    </div>
  );
}
