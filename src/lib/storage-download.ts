// Helpers for forcing downloads from Supabase Storage with a meaningful
// filename rather than the opaque storage hash that the bucket
// otherwise returns.
//
// Supabase signed URLs accept a `download` query parameter that makes
// the bucket respond with `Content-Disposition: attachment;
// filename="<value>"` for that one request. We do not need to re-sign;
// appending the param works on any already-signed URL.
//
// `download=1` (boolean form) preserves the original filename, which is
// the storage hash and not useful. We always pass an explicit name.

const FILENAME_SAFE = /[^a-z0-9_\-.]+/gi;

/**
 * Slugify a value into something safe for a filename component.
 * Keeps a-z, 0-9, dot, hyphen, underscore. Collapses runs of unsafe
 * characters into a single hyphen, trims leading/trailing hyphens.
 */
export function slugifyForFilename(input: string | null | undefined): string {
  const raw = (input ?? "").trim();
  if (!raw) return "file";
  return raw.toLowerCase().replace(FILENAME_SAFE, "-").replace(/^-+|-+$/g, "") || "file";
}

/**
 * Append a `download=<filename>` query param to a signed Supabase URL
 * so the response carries Content-Disposition: attachment with the
 * requested filename. If the URL already has a `download` param we
 * replace it.
 */
export function withDownloadFilename(signedUrl: string, filename: string): string {
  try {
    const url = new URL(signedUrl);
    url.searchParams.set("download", filename);
    return url.toString();
  } catch {
    // Fallback for callers that pass a relative path. Best-effort string
    // concat; URL parsing would have caught any malformed input above.
    const sep = signedUrl.includes("?") ? "&" : "?";
    return `${signedUrl}${sep}download=${encodeURIComponent(filename)}`;
  }
}

/**
 * Best-effort extension extractor from a storage path. Falls back to
 * the supplied default when the path has no recognizable extension.
 */
export function extensionFromPath(path: string | null | undefined, fallback = "jpg"): string {
  if (!path) return fallback;
  const dot = path.lastIndexOf(".");
  if (dot === -1 || dot === path.length - 1) return fallback;
  const ext = path.slice(dot + 1).toLowerCase();
  // Strip query string if a full URL was passed
  return ext.split(/[?#]/)[0] || fallback;
}
