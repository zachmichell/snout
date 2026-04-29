import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Users, Copy } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import StatusBadge, { commPrefTone } from "@/components/portal/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { downloadCsv, toCsv } from "@/lib/csv";
import { Download } from "lucide-react";
import PageSizeSelect, { usePageSize, setStoredPageSize } from "@/components/portal/PageSizeSelect";
import DuplicateReviewDialog from "@/components/portal/DuplicateReviewDialog";
import SortableHeader, { type SortState } from "@/components/portal/SortableHeader";

const PAGE_SIZE_KEY = "owners.pageSize";

export default function OwnersList() {
  const { can } = usePermissions();
  const canCreate = can("owners.create");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSizeState] = useState(() => usePageSize(PAGE_SIZE_KEY, 25));
  const [dupeOpen, setDupeOpen] = useState(false);
  const [sort, setSort] = useState<SortState>({ column: "first_name", dir: "asc" });

  const setPageSize = (n: number) => {
    setStoredPageSize(PAGE_SIZE_KEY, n);
    setPageSizeState(n);
    setPage(0);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["owners", search, page, pageSize, sort],
    queryFn: async () => {
      let q = supabase
        .from("owners")
        .select("id, first_name, last_name, email, phone, communication_preference, created_at, pet_owners(id)", {
          count: "exact",
        })
        .is("deleted_at", null);

      if (sort) {
        q = q.order(sort.column, { ascending: sort.dir === "asc", nullsFirst: false });
        if (sort.column === "first_name") {
          q = q.order("last_name", { ascending: sort.dir === "asc", nullsFirst: false });
        }
      } else {
        q = q.order("created_at", { ascending: false });
      }

      q = q.range(page * pageSize, page * pageSize + pageSize - 1);

      const term = search.trim();
      if (term) {
        q = q.or(
          `first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`,
        );
      }
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const totalPages = useMemo(() => Math.max(1, Math.ceil((data?.count ?? 0) / pageSize)), [data?.count, pageSize]);
  const rangeStart = (data?.count ?? 0) === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min((page + 1) * pageSize, data?.count ?? 0);

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Owners"
          actions={
            <div className="flex gap-2">
              {can("data.export") && (
                <Button variant="outline" onClick={async () => {
                  const { data } = await supabase.from("owners")
                    .select("first_name, last_name, email, phone, street_address, city, state_province, postal_code, communication_preference, notes, store_credit_cents, created_at")
                    .is("deleted_at", null).order("created_at", { ascending: false }).limit(5000);
                  downloadCsv(`owners-${new Date().toISOString().slice(0,10)}.csv`, toCsv(data ?? []));
                }}>
                  <Download className="h-4 w-4" /> Export CSV
                </Button>
              )}
              <Button variant="outline" onClick={() => setDupeOpen(true)}>
                <Copy className="h-4 w-4" /> Find Duplicates
              </Button>
              {canCreate && (
                <Button onClick={() => navigate("/owners/new")}>
                  <Plus className="h-4 w-4" /> Add Owner
                </Button>
              )}
            </div>
          }
        />

        <div className="rounded-lg border border-border bg-surface shadow-card">
          <div className="flex items-center gap-3 border-b border-border-subtle p-4">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
              <Input
                placeholder="Search owners…"
                value={search}
                onChange={(e) => {
                  setPage(0);
                  setSearch(e.target.value);
                }}
                className="bg-background pl-9"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
          ) : data && data.rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Users}
                title="No owners yet"
                description="Add your first pet owner to get started."
                action={
                  <Button onClick={() => navigate("/owners/new")}>
                    <Plus className="h-4 w-4" /> Add Owner
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-background text-left">
                    <SortableHeader column="first_name" sort={sort} onSort={(s) => { setPage(0); setSort(s); }}>Name</SortableHeader>
                    <SortableHeader column="email" sort={sort} onSort={(s) => { setPage(0); setSort(s); }}>Email</SortableHeader>
                    <SortableHeader column="phone" sort={sort} onSort={(s) => { setPage(0); setSort(s); }}>Phone</SortableHeader>
                    <th className="px-[18px] py-[14px] label-eyebrow">Pets</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Comm.</th>
                    <SortableHeader column="created_at" sort={sort} onSort={(s) => { setPage(0); setSort(s); }}>Created</SortableHeader>
                  </tr>
                </thead>
                <tbody>
                  {data!.rows.map((o: any) => (
                    <tr key={o.id} className="border-t border-border-subtle hover:bg-background">
                      <td className="px-[18px] py-[14px]">
                        <Link to={`/owners/${o.id}`} className="font-medium text-foreground hover:text-primary">
                          {o.first_name} {o.last_name}
                        </Link>
                      </td>
                      <td className="px-[18px] py-[14px] text-text-secondary">{o.email ?? "—"}</td>
                      <td className="px-[18px] py-[14px] text-text-secondary">{o.phone ?? "—"}</td>
                      <td className="px-[18px] py-[14px]">
                        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-pill bg-primary-light px-2 text-xs font-semibold text-primary">
                          {o.pet_owners?.length ?? 0}
                        </span>
                      </td>
                      <td className="px-[18px] py-[14px]">
                        <StatusBadge tone={commPrefTone(o.communication_preference)}>
                          {o.communication_preference}
                        </StatusBadge>
                      </td>
                      <td className="px-[18px] py-[14px] text-text-secondary">{formatDate(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-4 py-3 text-xs text-text-secondary">
                <span>
                  Showing {rangeStart}-{rangeEnd} of {data!.count.toLocaleString()} owner{data!.count === 1 ? "" : "s"}
                </span>
                <div className="flex items-center gap-3">
                  <PageSizeSelect value={pageSize} onChange={setPageSize} />
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
              </div>
            </>
          )}
        </div>
      </div>

      <DuplicateReviewDialog open={dupeOpen} onOpenChange={setDupeOpen} mode="owner" />
    </PortalLayout>
  );
}
