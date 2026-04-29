import { useState } from "react";
import PortalLayout from "@/components/portal/PortalLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, UserCog, Pencil } from "lucide-react";
import { useGroomers, type Groomer } from "@/hooks/useGroomers";
import GroomerFormDialog from "./GroomerFormDialog";

const DAY_DOTS = [
  { full: "Monday", short: "M" },
  { full: "Tuesday", short: "T" },
  { full: "Wednesday", short: "W" },
  { full: "Thursday", short: "T" },
  { full: "Friday", short: "F" },
  { full: "Saturday", short: "S" },
  { full: "Sunday", short: "S" },
];

export function GroomerManagementSection() {
  const { data: groomers = [], isLoading } = useGroomers();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Groomer | null>(null);

  const openAdd = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (g: Groomer) => { setEditing(g); setDialogOpen(true); };

  return (
    <>
    <div className="px-8 py-6">
        <header className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="font-display text-2xl text-foreground">Groomer Management</h1>
            <p className="mt-1 text-sm text-text-secondary">Manage your grooming team</p>
          </div>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" /> Add Groomer
          </Button>
        </header>

        {isLoading ? (
          <div className="text-sm text-text-secondary">Loading...</div>
        ) : groomers.length === 0 ? (
          <Card className="flex flex-col items-center justify-center gap-3 p-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-primary">
              <UserCog className="h-7 w-7" />
            </div>
            <div className="font-display text-lg">No groomers yet</div>
            <p className="max-w-sm text-sm text-text-secondary">
              Add your first groomer to start scheduling grooming appointments.
            </p>
            <Button onClick={openAdd} className="mt-2"><Plus className="h-4 w-4" /> Add Groomer</Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {groomers.map((g) => (
              <Card key={g.id}
                className="cursor-pointer p-5 transition-shadow hover:shadow-elevated"
                onClick={() => openEdit(g)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-display text-base text-foreground truncate">{g.display_name}</div>
                    {g.bio && <p className="mt-1 text-xs text-text-secondary line-clamp-2">{g.bio}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={g.status === "active" ? "default" : "secondary"} className="text-[10px]">
                      {g.status === "active" ? "Active" : "Inactive"}
                    </Badge>
                    <Pencil className="h-4 w-4 text-text-tertiary" />
                  </div>
                </div>

                {g.specialties.length > 0 && (
                  <div className="mt-3">
                    <div className="label-eyebrow mb-1.5">Specialties</div>
                    <div className="flex flex-wrap gap-1">
                      {g.specialties.map((s) => (
                        <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {g.certifications.length > 0 && (
                  <div className="mt-3">
                    <div className="label-eyebrow mb-1.5">Certifications</div>
                    <div className="flex flex-wrap gap-1">
                      {g.certifications.map((c) => (
                        <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex items-center gap-4 border-t border-border-subtle pt-3 text-xs text-text-secondary">
                  {g.commission_rate_percent != null && (
                    <div>
                      <span className="text-text-tertiary">Commission: </span>
                      <span className="font-medium text-foreground">{g.commission_rate_percent}%</span>
                    </div>
                  )}
                  <div>
                    <span className="text-text-tertiary">Max/day: </span>
                    <span className="font-medium text-foreground">{g.max_appointments_per_day}</span>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-1">
                  {DAY_DOTS.map((d, idx) => {
                    const on = g.working_days.includes(d.full);
                    return (
                      <div
                        key={`${d.full}-${idx}`}
                        title={d.full}
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${
                          on ? "bg-primary text-primary-foreground" : "bg-muted text-text-tertiary"
                        }`}
                      >
                        {d.short}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <GroomerFormDialog open={dialogOpen} onOpenChange={setDialogOpen} groomer={editing} />
    </>
  );
}

export default function GroomerManagement() {
  return (
    <PortalLayout>
      <GroomerManagementSection />
    </PortalLayout>
  );
}
