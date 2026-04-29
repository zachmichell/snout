// Cross-browser webcam player. Three branches:
//
//   * iframe: third-party hosted dashboard (UniFi Protect, Reolink web,
//     Cammie, LiveStream Pets). We trust the operator to paste the
//     correct URL; the iframe sandboxes prevent it from messing with
//     our origin.
//
//   * mp4: progressive download or HTTP-streaming MP4. Native <video>
//     handles this without any extra library.
//
//   * hls: live or VOD m3u8. Safari plays this natively; everything
//     else needs hls.js. We dynamic-import hls.js so the bundle does
//     not pay the cost on pages that have no webcams.
import { useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, Maximize, PictureInPicture } from "lucide-react";
import { Button } from "@/components/ui/button";

export type WebcamSource = {
  kind: "hls" | "mp4" | "iframe";
  url: string;
  name: string;
};

export default function WebcamPlayer({ source }: { source: WebcamSource }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (source.kind !== "hls") {
      setLoading(false);
      return;
    }
    const video = videoRef.current;
    if (!video) return;

    let hls: import("hls.js").default | null = null;
    let cancelled = false;
    setError(null);
    setLoading(true);

    (async () => {
      // Safari and iOS handle HLS natively. We detect via canPlayType
      // before reaching for hls.js.
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = source.url;
        video.addEventListener("loadeddata", () => !cancelled && setLoading(false), {
          once: true,
        });
        return;
      }

      try {
        const Hls = (await import("hls.js")).default;
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setError("This browser does not support live streaming. Try Chrome, Firefox, or Safari.");
          setLoading(false);
          return;
        }
        hls = new Hls({
          // Conservative defaults: low buffer, fast manifest fetch,
          // best for live security feeds where the user wants the
          // current frame, not perfect playback.
          maxBufferLength: 10,
          liveSyncDurationCount: 3,
        });
        hls.loadSource(source.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!cancelled) setLoading(false);
        });
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (data.fatal) {
            console.error("hls.js fatal error:", data);
            if (!cancelled) {
              setError(data.details || "Stream playback error");
              setLoading(false);
            }
          }
        });
      } catch (e) {
        console.error("hls.js load failed:", e);
        if (!cancelled) {
          setError("Could not load the stream player.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
    };
  }, [source.url, source.kind]);

  const enterFullscreen = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  };

  const togglePip = async () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (el as any).requestPictureInPicture?.();
      }
    } catch (e) {
      console.warn("PiP failed:", e);
    }
  };

  if (source.kind === "iframe") {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
        <iframe
          src={source.url}
          title={source.name}
          allow="autoplay; fullscreen; picture-in-picture"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups"
          className="h-full w-full"
        />
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
      <video
        ref={videoRef}
        src={source.kind === "mp4" ? source.url : undefined}
        className="h-full w-full object-contain"
        playsInline
        autoPlay
        muted
        controls
      />
      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-white">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-4 text-center text-sm text-white">
          <AlertTriangle className="h-6 w-6 text-warning" />
          <span>{error}</span>
        </div>
      )}
      {!error && (
        <div className="absolute right-2 top-2 flex gap-1">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={togglePip}
            className="h-8 w-8 bg-black/60 text-white hover:bg-black/80"
            aria-label="Picture in picture"
          >
            <PictureInPicture className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={enterFullscreen}
            className="h-8 w-8 bg-black/60 text-white hover:bg-black/80"
            aria-label="Fullscreen"
          >
            <Maximize className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
