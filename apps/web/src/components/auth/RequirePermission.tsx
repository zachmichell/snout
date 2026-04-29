import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import type { Permission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { can, isLoading } = usePermissions();

  if (isLoading) return null;

  if (!can(permission)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Card className="max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <h2 className="mb-2 font-serif text-xl font-semibold">Access restricted</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            You don't have permission to view this page. If you think this is a mistake, contact
            your administrator.
          </p>
          <Button asChild>
            <Link to="/dashboard">Back to Dashboard</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
