// Bell icon with an unread-count badge. Click opens a popover that
// shows the changelog feed (the same ChangelogPanel used in the support
// widget). Designed to live in the staff portal's top-right header.
import { Bell } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useChangelogUnreadCount } from "@/hooks/useChangelog";
import ChangelogPanel from "./ChangelogPanel";

export default function ChangelogBell() {
  const { data: unread } = useChangelogUnreadCount();
  const count = unread ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Changelog">
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b border-border-subtle px-4 py-3">
          <h3 className="font-display text-sm font-semibold text-foreground">
            What's new
          </h3>
          <p className="text-xs text-text-tertiary">
            Platform announcements and updates from your organization.
          </p>
        </div>
        <ChangelogPanel compact />
      </PopoverContent>
    </Popover>
  );
}
