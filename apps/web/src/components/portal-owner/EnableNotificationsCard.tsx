// Owner-portal opt-in card for web push. Shows up on the dashboard
// when the user has not yet enabled push, hides itself once they have.
//
// Three branches:
//   * granted + subscribed: card hides.
//   * granted but not subscribed (rare; user revoked through OS): show
//     "re-enable" affordance.
//   * default (never asked) or denied: prompt with rationale.
//   * unsupported / missing-key: render a friendly explanation rather
//     than a silent no-op so the operator sees something is up.
//
// Special case for iOS Safari: web push only works in installed PWAs
// (Add to Home Screen) on iOS 16.4+. We detect that and show the
// install instructions inline instead of a button that would no-op.
import { Bell, BellOff, Smartphone, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWebPush } from "@/hooks/useWebPush";

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
}

export default function EnableNotificationsCard() {
  const { permission, isSubscribed, isStandalonePwa, subscribe, unsubscribe } = useWebPush();

  // Already on; nothing to show.
  if (permission === "granted" && isSubscribed) return null;

  // iOS Safari without standalone display mode: web push will not work
  // until the user adds the site to their Home Screen.
  if (isIosSafari() && !isStandalonePwa && permission !== "denied") {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-accent/10 p-2 text-accent">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-base font-semibold text-foreground">
              Get push notifications on iPhone
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Apple only sends push notifications when this site is installed as an app.
              Tap the share icon in Safari, then "Add to Home Screen". Open the app from
              your Home Screen and we'll prompt to enable notifications.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (permission === "unsupported") {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-muted p-2 text-muted-foreground">
            <BellOff className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-base font-semibold text-foreground">
              Notifications not supported here
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              This browser does not support push notifications. Try a recent Chrome,
              Firefox, or Edge, or install the iOS PWA from Safari.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (permission === "missing-key") {
    // Not the user's problem; the deploy is missing config. Don't
    // surface the dirty laundry on the owner-facing dashboard.
    return null;
  }

  if (permission === "denied") {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-destructive/10 p-2 text-destructive">
            <BellOff className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-base font-semibold text-foreground">
              Notifications are blocked
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              You blocked notifications for Snout in your browser. Open your site
              settings (lock icon next to the URL) and re-enable notifications, then
              refresh this page.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent-light/40 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-accent p-2 text-white">
          <Bell className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-base font-semibold text-foreground">
            Get notified about your pets
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn on notifications and we will let you know when a new report card
            arrives, photos go up, your booking is confirmed, or a payment receipt is
            ready. You can turn them off any time.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              onClick={async () => {
                const res = await subscribe();
                if (res.ok) toast.success("Notifications enabled");
                else toast.error(res.error ?? "Could not enable notifications");
              }}
            >
              <Bell className="h-4 w-4" /> Enable notifications
            </Button>
            {permission === "granted" && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const res = await unsubscribe();
                  if (res.ok) toast.success("Notifications turned off");
                  else toast.error(res.error ?? "Could not disable notifications");
                }}
              >
                <Check className="h-4 w-4" /> Already on, turn off
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
