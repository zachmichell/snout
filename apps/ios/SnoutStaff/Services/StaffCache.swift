//
//  StaffCache.swift
//  Snout Staff
//
//  Tiny on-disk JSON cache for read-only "today" data, so the schedule,
//  dashboard, pet list, and grooming/training day views stay viewable when
//  the signal drops. The pattern in each view model: load the cache first
//  (instant render), fetch fresh, overwrite the cache on success, and keep
//  the cached copy on failure. Keys include the org + day so stale days
//  don't surface.
//

import Foundation

enum StaffCache {
    private static let dir: URL = {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let d = base.appendingPathComponent("SnoutStaffCache", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    private static func fileURL(_ key: String) -> URL {
        let safe = key.replacingOccurrences(of: "/", with: "_")
        return dir.appendingPathComponent(safe + ".json")
    }

    private static var encoder: JSONEncoder {
        let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; return e
    }
    private static var decoder: JSONDecoder {
        let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d
    }

    static func save<T: Encodable>(_ value: T, key: String) {
        guard let data = try? encoder.encode(value) else { return }
        try? data.write(to: fileURL(key), options: .atomic)
    }

    static func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = try? Data(contentsOf: fileURL(key)) else { return nil }
        return try? decoder.decode(T.self, from: data)
    }

    /// yyyy-MM-dd in the device's calendar, for day-scoped cache keys.
    static func todayKey() -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }
}
