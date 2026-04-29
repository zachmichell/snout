import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Wrench } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import ModuleBadge from "@/components/portal/ModuleBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useOrgModules } from "@/hooks/useOrgModules";
import { formatCentsShort, formatDurationType } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";

const PAGE_SIZE = 10;

export default function ServicesList() {
  const { can } = usePermissions();
  const canManage = can("services.manage");
  const navigate = useNavigate();
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const { data: enabledModules } = useOrgModules();

  const { data, isLoading } = useQuery({
    queryKey: ["services", moduleFilter, page],
    queryFn: async () => {
      let q = supabase
        .from("services")
        .select("id, name, module, duration_type, base_price_cents, active, created_at, location_id, locations(name)", {
          count: "exact",
        })
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (moduleFilter !== "all") {
        q = q.eq("module", moduleFilter as any);
      } else if (enabledModules && enabledModules.size > 0) {
        // gate by org-enabled modules when not filtering
        q = q.in("module", Array.from(enabledModules) as any);
      }

      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const totalPages = useMemo(() => Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE)), [data?.count]);

  const showFilter = !enabledModules || enabledModules.size !== 1;

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Services"
          actions={
            canManage ? (
              <Button onClick={() => navigate("/services/new")}>
                <Plus className="h-4 w-4" /> Add Service
              </Button>
            ) : null
          }
        />

        <div className="rounded-lg border border-border bg-surface shadow-card">
          {showFilter && (
            <div className="flex items-center gap-3 border-b border-border-subtle p-4">
              <div className="w-44">
                <Select
                  value={moduleFilter}
                  onValueChange={(v) => {
                    setPage(0);
                    setModuleFilter(v);
                  }}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All modules</SelectItem>
                    {(!enabledModules || enabledModules.has("daycare")) && (
                      <SelectItem value="daycare">Daycare</SelectItem>
                    )}
                    {(!enabledModules || enabledModules.has("boarding")) && (
                      <SelectItem value="boarding">Boarding</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
          ) : data && data.rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Wrench}
                title="No services yet"
                description="Add your first service to start taking bookings."
                action={
                  <Button onClick={() => navigate("/services/new")}>
                    <Plus className="h-4 w-4" /> Add Service
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-background text-left">
                    <th className="px-[18px] py-[14px] label-eyebrow">Name</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Module</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Duration</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Base Price</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Location</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Active</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.rows.map((s: any) => (
                    <tr key={s.id} className="border-t border-border-subtle hover:bg-background">
                      <td className="px-[18px] py-[14px]">
                        <Link
                          to={`/services/${s.id}`}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {s.name}
                        </Link>
                      </td>
                      <td className="px-[18px] py-[14px]">
                        <ModuleBadge module={s.module} />
                      </td>
                      <td className="px-[18px] py-[14px] text-text-secondary">
                        {formatDurationType(s.duration_type)}
                      </td>
                      <td className="px-[18px] py-[14px] text-foreground">
                        {formatCentsShort(s.base_price_cents)}
                      </td>
                      <td className="px-[18px] py-[14px] text-text-secondary">
                        {s.locations?.name ?? "—"}
                      </td>
                      <td className="px-[18px] py-[14px]">
                        {s.active ? (
                          <span className="inline-flex h-2 w-2 rounded-full bg-success" />
                        ) : (
                          <span className="inline-flex h-2 w-2 rounded-full bg-muted-foreground/40" />
                        )}
                      </td>
                      <td className="px-[18px] py-[14px] text-text-secondary">
                        {formatDate(s.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex items-center justify-between border-t border-border-subtle px-4 py-3 text-xs text-text-secondary">
                <span>
                  {data!.count} service{data!.count === 1 ? "" : "s"}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <span>
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
