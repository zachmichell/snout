import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export default function ProtectedRoute({
  children,
  requireOrg = true,
}: {
  children: React.ReactNode;
  requireOrg?: boolean;
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

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (requireOrg && !membership) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
