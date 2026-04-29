// Floating "Support" button in the bottom-right of every staff portal
// page. Click opens a panel with three tabs:
//
//   * Status   — links to a status page if VITE_STATUS_PAGE_URL is set;
//                otherwise renders a "All systems operational" placeholder.
//   * Updates  — embeds the changelog feed (same component as the bell).
//   * Contact  — opens the ReportIssueDialog.
//
// Live chat is intentionally NOT here. The audit punted on a vendor; if
// you decide on Intercom / Plain / Crisp later, this is where the JS
// snippet drops in. The TODO at the bottom of this file points at the
// exact spot.
import { useState } from "react";
import { LifeBuoy, ExternalLink, MessageSquare, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ChangelogPanel from "./ChangelogPanel";
import ReportIssueDialog from "./ReportIssueDialog";
import { useChangelogUnreadCount } from "@/hooks/useChangelog";

const STATUS_PAGE_URL = import.meta.env.VITE_STATUS_PAGE_URL ?? "";

export default function SupportWidget() {
  const [reportOpen, setReportOpen] = useState(false);
  const { data: unread } = useChangelogUnreadCount();
  const unreadCount = unread ?? 0;

  return (
    <>
      <div className="fixed bottom-4 right-4 z-40">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              className="relative rounded-full bg-foreground text-background shadow-card hover:bg-foreground/90"
              size="icon"
              aria-label="Support"
            >
              <LifeBuoy className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            side="top"
            className="w-96 p-0"
            sideOffset={12}
          >
            <div className="border-b border-border-subtle px-4 py-3">
              <h3 className="font-display text-sm font-semibold text-foreground">
                Support
              </h3>
              <p className="text-xs text-text-tertiary">
                Status, recent updates, and ways to reach the team.
              </p>
            </div>
            <Tabs defaultValue="status">
              <TabsList className="grid w-full grid-cols-3 rounded-none border-b border-border-subtle bg-transparent p-0">
                <TabsTrigger value="status" className="rounded-none data-[state=active]:bg-background">
                  Status
                </TabsTrigger>
                <TabsTrigger value="updates" className="rounded-none data-[state=active]:bg-background">
                  Updates
                </TabsTrigger>
                <TabsTrigger value="contact" className="rounded-none data-[state=active]:bg-background">
                  Contact
                </TabsTrigger>
              </TabsList>

              <TabsContent value="status" className="m-0 p-4">
                <StatusTab />
              </TabsContent>

              <TabsContent value="updates" className="m-0">
                <ChangelogPanel compact />
              </TabsContent>

              <TabsContent value="contact" className="m-0 space-y-3 p-4">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setReportOpen(true)}
                >
                  <MessageSquare className="h-4 w-4" /> Report an issue
                </Button>
                <p className="text-xs text-text-tertiary">
                  Most issues route through email. Critical outages page on-call
                  directly.
                </p>
                {/* TODO(support-chat): when an Intercom / Plain / Crisp account is
                    provisioned, drop the vendor's JS snippet into App.tsx and
                    surface the open-chat call here. */}
              </TabsContent>
            </Tabs>
          </PopoverContent>
        </Popover>
      </div>

      <ReportIssueDialog open={reportOpen} onOpenChange={setReportOpen} />
    </>
  );
}

function StatusTab() {
  if (STATUS_PAGE_URL) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">
          Live system status is published at our status page. Subscribe there to get
          incident notifications.
        </p>
        <a
          href={STATUS_PAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
        >
          Open status page <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-md border border-success/30 bg-mist-bg p-3 text-sm">
        <ChevronUp className="h-4 w-4 text-success" />
        <span className="font-medium text-foreground">All systems operational</span>
      </div>
      <p className="text-xs text-text-tertiary">
        A live status page is not yet configured. When it is, this panel will link
        directly to it.
      </p>
    </div>
  );
}
