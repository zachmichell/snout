import { FileText } from "lucide-react";
import WaiverCard from "@/components/portal-owner/WaiverCard";
import { useOwnerWaivers } from "@/hooks/useOwnerWaivers";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";

export default function OwnerWaivers() {
  const { data: owner, isLoading: ownerLoading } = useOwnerRecord();
  const { data: waivers = [], isLoading } = useOwnerWaivers();

  if (!ownerLoading && !owner) {
    return (
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">Waivers & Agreements</h1>
        <div className="mt-8 rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
          <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 text-lg font-medium text-foreground">Account setup in progress</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account isn't fully set up yet — please contact the business.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-foreground">Waivers & Agreements</h1>
        <p className="mt-2 text-base text-muted-foreground">
          Review and sign required documents
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : waivers.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
          <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 text-base text-foreground">No waivers required at this time.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {waivers.map((w) => (
            <li key={w.id}>
              <WaiverCard waiver={w} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
