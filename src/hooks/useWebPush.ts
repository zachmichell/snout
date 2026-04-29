// Browser-side wiring for Web Push. Three responsibilities:
//   1. Register the service worker (idempotent; the browser deduplicates).
//   2. Read current Notification permission state.
//   3. Subscribe / unsubscribe via PushManager and persist the
//      subscription on the server in push_subscriptions.
//
// VAPID public key comes from VITE_VAPID_PUBLIC_KEY at build time. If
// it is missing, the hook surfaces an unsupported state — better than
// silently failing the subscribe call when the user clicks "enable".
//
// iOS Safari note: Push only works in installed PWAs (Add to Home
// Screen) on iOS 16.4+. The opt-in card surfaces this; the hook itself
// just reports whether `serviceWorker` and `PushManager` are present.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushPermission = "default" | "granted" | "denied" | "unsupported" | "missing-key";

type State = {
  permission: PushPermission;
  isSubscribed: boolean;
  isStandalonePwa: boolean;
};

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function readPermissionState(): PushPermission {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (!VAPID_PUBLIC_KEY) return "missing-key";
  return Notification.permission as PushPermission;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // Safari iOS-specific
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const standalone = (window.navigator as any).standalone === true;
  // Other browsers
  const display = window.matchMedia("(display-mode: standalone)").matches;
  return standalone || display;
}

export function useWebPush() {
  const { user } = useAuth();
  const [state, setState] = useState<State>({
    permission: readPermissionState(),
    isSubscribed: false,
    isStandalonePwa: isStandalone(),
  });

  // Register the service worker once on mount and read the existing
  // subscription, if any. This populates isSubscribed without requiring
  // the user to interact.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;

    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        setState((s) => ({ ...s, isSubscribed: !!sub, permission: readPermissionState() }));
      } catch (e) {
        console.warn("service worker register failed:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!user?.id) return { ok: false, error: "Not signed in" };
    const perm = readPermissionState();
    if (perm === "unsupported") return { ok: false, error: "Push not supported in this browser" };
    if (perm === "missing-key") {
      return { ok: false, error: "Push notifications are not configured for this Snout install" };
    }

    try {
      const reg = await navigator.serviceWorker.ready;

      // Ask for permission. Browsers gate this on a user gesture, so
      // the caller must invoke us from a click handler.
      let permission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission();
      }
      if (permission !== "granted") {
        setState((s) => ({ ...s, permission: permission as PushPermission }));
        return { ok: false, error: "Notification permission denied" };
      }

      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
        }));

      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        return { ok: false, error: "Push subscription is missing required keys" };
      }

      // Persist server-side. Upsert on endpoint so a re-subscribe
      // refreshes the keys without creating a duplicate row.
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          profile_id: user.id,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          user_agent: navigator.userAgent,
          last_seen_at: new Date().toISOString(),
          deleted_at: null,
        },
        { onConflict: "endpoint", ignoreDuplicates: false },
      );
      if (error) {
        console.error("push_subscriptions upsert failed:", error);
        return { ok: false, error: error.message };
      }

      setState({ permission: "granted", isSubscribed: true, isStandalonePwa: isStandalone() });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not enable notifications";
      console.error("subscribe failed:", e);
      return { ok: false, error: msg };
    }
  }, [user?.id]);

  const unsubscribe = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        // Soft-delete the row so the edge function stops fanning out.
        if (user?.id) {
          await supabase
            .from("push_subscriptions")
            .update({ deleted_at: new Date().toISOString() })
            .eq("profile_id", user.id)
            .eq("endpoint", endpoint);
        }
      }
      setState((s) => ({ ...s, isSubscribed: false }));
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not disable notifications";
      return { ok: false, error: msg };
    }
  }, [user?.id]);

  return { ...state, subscribe, unsubscribe };
}
