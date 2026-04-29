import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { useLocations } from "@/hooks/useLocations";
import { useOwnerBookings, type OwnerBooking } from "@/hooks/useOwnerBookings";
import BookingCard from "@/components/portal-owner/BookingCard";
import BookingWizard from "@/components/portal-owner/booking-wizard/BookingWizard";

export default function Bookings() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const { data: owner } = useOwnerRecord();
  const { data: locations = [] } = useLocations();
  const { data: bookings = [], isLoading } = useOwnerBookings(owner?.id);

  const showLocation = locations.length > 1;

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const upcoming: OwnerBooking[] = [];
    const past: OwnerBooking[] = [];
    for (const b of bookings) {
      const isPastByTime = new Date(b.end_at).getTime() < now;
      const isFinished = ["checked_out", "cancelled", "no_show"].includes(b.status);
      const isUpcomingStatus = ["requested", "confirmed"].includes(b.status);
      if (isUpcomingStatus && !isPastByTime) upcoming.push(b);
      else if (isFinished || isPastByTime) past.push(b);
      else upcoming.push(b);
    }
    upcoming.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    past.sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime());
    return { upcoming, past };
  }, [bookings]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">My Bookings</h1>
          <p className="mt-2 text-base text-muted-foreground">View and manage your reservations</p>
        </div>
        <Button onClick={() => setWizardOpen(true)} size="lg">
          <Plus className="mr-1.5 h-4 w-4" /> Book Now
        </Button>
      </div>

      <Tabs defaultValue="upcoming" className="space-y-4">
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
          <TabsTrigger value="past">Past ({past.length})</TabsTrigger>
          <TabsTrigger value="all">All ({bookings.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming">
          <BookingList
            list={upcoming}
            isLoading={isLoading}
            showLocation={showLocation}
            empty="No upcoming bookings — Book your next visit!"
            onBook={() => setWizardOpen(true)}
          />
        </TabsContent>
        <TabsContent value="past">
          <BookingList
            list={past}
            isLoading={isLoading}
            showLocation={showLocation}
            empty="No past bookings yet."
          />
        </TabsContent>
        <TabsContent value="all">
          <BookingList
            list={[...upcoming, ...past]}
            isLoading={isLoading}
            showLocation={showLocation}
            empty="No bookings yet — Book your first visit!"
            onBook={() => setWizardOpen(true)}
          />
        </TabsContent>
      </Tabs>

      <BookingWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}

function BookingList({
  list,
  isLoading,
  showLocation,
  empty,
  onBook,
}: {
  list: OwnerBooking[];
  isLoading: boolean;
  showLocation: boolean;
  empty: string;
  onBook?: () => void;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (list.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
        <p className="text-base font-medium text-foreground">{empty}</p>
        {onBook && (
          <Button onClick={onBook} className="mt-4">
            <Plus className="mr-1.5 h-4 w-4" /> Book Now
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      {list.map((b) => (
        <BookingCard key={b.id} booking={b} showLocation={showLocation} />
      ))}
    </div>
  );
}
