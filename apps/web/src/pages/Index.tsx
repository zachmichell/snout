import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { defaultLandingForRole, type Role } from "@/lib/permissions";

export default function Index() {
  const { user, membership, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!membership) return <Navigate to="/onboarding" replace />;
  return <Navigate to={defaultLandingForRole(membership.role as Role)} replace />;
}
