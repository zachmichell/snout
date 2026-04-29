//
//  StorageDownload.swift
//  Snout
//
//  Web parity: src/lib/storage-download.ts
//  Both implementations must satisfy the same inputs and outputs.
//
//  Helpers for forcing downloads from Supabase Storage with a meaningful filename.
//  Supabase signed URLs accept a `download` query param; appending it makes the bucket
//  respond with Content-Disposition: attachment.
//

import Foundation

enum StorageDownload {
    /// Slugify a value into something safe for a filename component.
    /// Keeps a-z, 0-9, dot, hyphen, underscore. Collapses runs of unsafe characters
    /// into a single hyphen. Trims leading/trailing hyphens. Empty/whitespace input → "file".
    static func slugifyForFilename(_ input: String?) -> String {
        let raw = (input ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { return "file" }
        let lower = raw.lowercased()
        // Replace any run of characters NOT in [a-z0-9_.\-] with a single "-"
        let safeSet = Set("abcdefghijklmnopqrstuvwxyz0123456789_-.")
        var collapsed = ""
        var pendingDash = false
        for ch in lower {
            if safeSet.contains(ch) {
                if pendingDash { collapsed.append("-"); pendingDash = false }
                collapsed.append(ch)
            } else {
                pendingDash = true
            }
        }
        // Trim leading/trailing dashes
        let trimmed = collapsed.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return trimmed.isEmpty ? "file" : trimmed
    }

    /// Append a `download=<filename>` query parameter to a signed Supabase URL so the
    /// response carries Content-Disposition: attachment with the requested filename.
    /// If the URL already has a `download` param it is replaced.
    static func withDownloadFilename(signedURL: String, filename: String) -> String {
        guard var components = URLComponents(string: signedURL) else {
            // Fallback: best-effort string concat for callers that pass a relative path
            let sep = signedURL.contains("?") ? "&" : "?"
            let encoded = filename.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? filename
            return "\(signedURL)\(sep)download=\(encoded)"
        }
        var items = components.queryItems ?? []
        items.removeAll { $0.name == "download" }
        items.append(URLQueryItem(name: "download", value: filename))
        components.queryItems = items
        return components.url?.absoluteString ?? signedURL
    }

    /// Best-effort extension extractor from a storage path. Returns the supplied default
    /// when the path has no recognizable extension.
    static func extensionFromPath(_ path: String?, fallback: String = "jpg") -> String {
        guard let path, !path.isEmpty else { return fallback }
        guard let dotIndex = path.lastIndex(of: ".") else { return fallback }
        let after = path.index(after: dotIndex)
        guard after < path.endIndex else { return fallback }
        var ext = String(path[after...]).lowercased()
        // Strip query string or fragment if a full URL was passed
        if let q = ext.firstIndex(where: { $0 == "?" || $0 == "#" }) {
            ext = String(ext[..<q])
        }
        return ext.isEmpty ? fallback : ext
    }
}
