import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

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
  if (membership.role === "customer") return <Navigate to="/portal/dashboard" replace />;
  return <Navigate to="/dashboard" replace />;
}
