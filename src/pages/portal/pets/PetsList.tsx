import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, PawPrint, Copy } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import StatusBadge, { intakeTone } from "@/components/portal/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, speciesIcon } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { downloadCsv, toCsv } from "@/lib/csv";
import { Download } from "lucide-react";
import PageSizeSelect, { usePageSize, setStoredPageSize } from "@/components/portal/PageSizeSelect";
import DuplicateReviewDialog from "@/components/portal/DuplicateReviewDialog";
import SortableHeader, { type SortState } from "@/components/portal/SortableHeader";

const PAGE_SIZE_KEY = "pets.pageSize";

export default function PetsList() {
  const { can } = usePermissions();
  const canCreate = can("pets.create");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [species, setSpecies] = useState<string>("all");
  const [photoFilter, setPhotoFilter] = useState<"all" | "with" | "without">("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSizeState] = useState(() => usePageSize(PAGE_SIZE_KEY, 25));
  const [dupeOpen, setDupeOpen] = useState(false);
  const [sort, setSort] = useState<SortState>({ column: "name", dir: "asc" });

  const setPageSize = (n: number) => {
    setStoredPageSize(PAGE_SIZE_KEY, n);
    setPageSizeState(n);
    setPage(0);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["pets", search, species, photoFilter, page, pageSize, sort],
    queryFn: async () => {
      let q = supabase
        .from("pets")
        .select(
          "id, name, species, breed, weight_kg, intake_status, created_at, microchip_id, photo_url, pet_owners(role, relationship, owner:owners(id, first_name, last_name))",
          { count: "exact" },
        )
        .is("deleted_at", null);

      if (sort) {
        q = q.order(sort.column, { ascending: sort.dir === "asc", nullsFirst: false });
      } else {
        q = q.order("created_at", { ascending: false });
      }

      q = q.range(page * pageSize, page * pageSize + pageSize - 1);

      if (species !== "all") q = q.eq("species", species as any);
      if (photoFilter === "without") q = q.is("photo_url", null);
      else if (photoFilter === "with") q = q.not("photo_url", "is", null);
      const term = search.trim();
      if (term) q = q.or(`name.ilike.%${term}%,breed.ilike.%${term}%,microchip_id.ilike.%${term}%`);
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
          title="Pets"
          actions={
            <div className="flex gap-2">
              {can("data.export") && (
                <Button variant="outline" onClick={async () => {
                  const { data } = await supabase.from("pets")
                    .select("name, species, breed, color, sex, date_of_birth, weight_kg, microchip_id, intake_status, allergies, created_at")
                    .is("deleted_at", null).order("created_at", { ascending: false }).limit(5000);
                  downloadCsv(`pets-${new Date().toISOString().slice(0,10)}.csv`, toCsv(data ?? []));
                }}>
                  <Download className="h-4 w-4" /> Export CSV
                </Button>
              )}
              <Button variant="outline" onClick={() => setDupeOpen(true)}>
                <Copy className="h-4 w-4" /> Find Duplicates
              </Button>
              {canCreate && (
                <Button onClick={() => navigate("/pets/new")}>
                  <Plus className="h-4 w-4" /> Add Pet
                </Button>
              )}
            </div>
          }
        />

        <div className="rounded-lg border border-border bg-surface shadow-card">
          <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle p-4">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
              <Input
                placeholder="Search pets…"
                value={search}
                onChange={(e) => {
                  setPage(0);
                  setSearch(e.target.value);
                }}
                className="bg-background pl-9"
              />
            </div>
            <Select value={species} onValueChange={(v) => { setPage(0); setSpecies(v); }}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All species</SelectItem>
                <SelectItem value="dog">Dogs</SelectItem>
                <SelectItem value="cat">Cats</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Select value={photoFilter} onValueChange={(v) => { setPage(0); setPhotoFilter(v as typeof photoFilter); }}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Photo: any</SelectItem>
                <SelectItem value="with">Photo: with photo</SelectItem>
                <SelectItem value="without">Photo: missing</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
          ) : data && data.rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={PawPrint}
                title="No pets yet"
                description="Add your first pet to start building profiles."
                action={
                  canCreate ? (
                    <Button onClick={() => navigate("/pets/new")}>
                      <Plus className="h-4 w-4" /> Add Pet
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-background text-left">
                    <SortableHeader column="name" sort={sort} onSort={(s) => { setPage(0); setSort(s); }}>Name</SortableHeader>
                    <SortableHeader column="species" sort={sort} onSort={(s) => { setPage(0); setSort(s); }}>Species</SortableHeader>
                    <SortableHeader column="breed" sort={sort} onSort={(s) => { setPage(0); setSort(s); }}>Breed</SortableHeader>
                    <th className="px-[18px] py-[14px] label-eyebrow">Owners</th>
                    <SortableHeader column="weight_kg" sort={sort} onSort={(s) => { setPage(0); setSort(s); }}>Weight</SortableHeader>
                    <th className="px-[18px] py-[14px] label-eyebrow">Status</th>
                    <SortableHeader column="created_at" sort={sort} onSort={(s) => { setPage(0); setSort(s); }}>Created</SortableHeader>
                  </tr>
                </thead>
                <tbody>
                  {data!.rows.map((p: any) => {
                    const linked = (p.pet_owners ?? []).filter((po: any) => po.owner);
                    const primary = linked.find((po: any) => po.role === "primary") ?? linked[0];
                    const coOwners = linked.filter((po: any) => po !== primary);
                    return (
                      <tr key={p.id} className="border-t border-border-subtle hover:bg-background">
                        <td className="px-[18px] py-[14px]">
                          <Link to={`/pets/${p.id}`} className="font-medium text-foreground hover:text-primary">
                            {p.name}
                          </Link>
                        </td>
                        <td className="px-[18px] py-[14px]">
                          <span className="mr-1.5">{speciesIcon(p.species)}</span>
                          <span className="text-text-secondary capitalize">{p.species}</span>
                        </td>
                        <td className="px-[18px] py-[14px] text-text-secondary">{p.breed ?? "—"}</td>
                        <td className="px-[18px] py-[14px] text-text-secondary">
                          {!primary ? (
                            <span className="text-text-tertiary">Unlinked</span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <Link
                                to={`/owners/${primary.owner.id}`}
                                className="font-medium text-foreground hover:text-primary"
                              >
                                {primary.owner.first_name} {primary.owner.last_name}
                              </Link>
                              {coOwners.length > 0 && (
                                <span
                                  title={coOwners
                                    .map((co: any) => `${co.owner.first_name} ${co.owner.last_name}`)
                                    .join(", ")}
                                  className="rounded-pill border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary"
                                >
                                  +{coOwners.length}
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="px-[18px] py-[14px] text-text-secondary">
                          {p.weight_kg != null ? `${p.weight_kg} kg` : "—"}
                        </td>
                        <td className="px-[18px] py-[14px]">
                          <StatusBadge tone={intakeTone(p.intake_status)}>
                            {p.intake_status.replace("_", " ")}
                          </StatusBadge>
                        </td>
                        <td className="px-[18px] py-[14px] text-text-secondary">{formatDate(p.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-4 py-3 text-xs text-text-secondary">
                <span>
                  Showing {rangeStart}-{rangeEnd} of {data!.count.toLocaleString()} pet{data!.count === 1 ? "" : "s"}
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

      <DuplicateReviewDialog open={dupeOpen} onOpenChange={setDupeOpen} mode="pet" />
    </PortalLayout>
  );
}
