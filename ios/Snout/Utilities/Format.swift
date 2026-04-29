//
//  Format.swift
//  Snout
//
//  Web parity: src/lib/format.ts
//  Both implementations must satisfy the same inputs and outputs.
//

import Foundation

enum Format {
    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoNoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static let dateOnlyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(secondsFromGMT: 0)
        return f
    }()

    /// Parse a value that may be either an ISO 8601 datetime string or a yyyy-MM-dd date.
    static func parseDate(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        if let d = isoFormatter.date(from: value) { return d }
        if let d = isoNoFractional.date(from: value) { return d }
        if let d = dateOnlyFormatter.date(from: value) { return d }
        return nil
    }

    /// `formatDate(value)` — short medium date in the user's locale, or `—` if missing.
    static func formatDate(_ value: String?) -> String {
        guard let date = parseDate(value) else { return "—" }
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        return f.string(from: date)
    }

    /// `calcAge(dob)` — "X year(s) Y month(s)" / "X month(s)" — or nil if missing.
    static func calcAge(dob: String?, now: Date = Date()) -> String? {
        guard let birth = parseDate(dob) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone.current
        let comps = calendar.dateComponents([.year, .month], from: birth, to: now)
        let years = comps.year ?? 0
        let months = comps.month ?? 0
        if years <= 0 {
            return "\(months) month\(months == 1 ? "" : "s")"
        }
        if months == 0 {
            return "\(years) year\(years == 1 ? "" : "s")"
        }
        return "\(years) year\(years == 1 ? "" : "s") \(months) month\(months == 1 ? "" : "s")"
    }

    /// Convert kg to lbs to one decimal place. Returns nil when input is nil.
    static func kgToLbs(_ kg: Double?) -> String? {
        guard let kg else { return nil }
        return String(format: "%.1f", kg * 2.20462)
    }

    /// Emoji for species. Defaults to paw print for unknown species.
    static func speciesIcon(_ species: String?) -> String {
        switch species {
        case "dog": return "🐕"
        case "cat": return "🐈"
        default:    return "🐾"
        }
    }

    /// Turn snake_case enum values into "Snake case" display strings.
    /// Used for mood, energy_level, appetite, sociability, overall_rating.
    static func humanize(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "—" }
        let words = value.split(separator: "_").map(String.init)
        guard let first = words.first else { return value }
        let rest = words.dropFirst().joined(separator: " ")
        let head = first.prefix(1).uppercased() + first.dropFirst()
        return rest.isEmpty ? head : "\(head) \(rest)"
    }

    /// Emoji indicator for a report card mood enum.
    static func moodEmoji(_ mood: String?) -> String {
        switch mood {
        case "happy":   return "😊"
        case "playful": return "🎾"
        case "calm":    return "🌿"
        case "anxious": return "😟"
        case "tired":   return "😴"
        default:        return "🐾"
        }
    }

    /// Emoji indicator for energy level.
    static func energyEmoji(_ energy: String?) -> String {
        switch energy {
        case "high":   return "⚡"
        case "medium": return "🌤"
        case "low":    return "🌙"
        default:       return "·"
        }
    }

    /// Emoji indicator for appetite.
    static func appetiteEmoji(_ appetite: String?) -> String {
        switch appetite {
        case "ate_all":    return "🍽"
        case "ate_some":   return "🥣"
        case "ate_little": return "🍚"
        case "refused":    return "🚫"
        default:           return "·"
        }
    }

    /// Emoji indicator for sociability.
    static func sociabilityEmoji(_ s: String?) -> String {
        switch s {
        case "very_social":   return "💞"
        case "social":        return "🤝"
        case "selective":     return "🤔"
        case "kept_to_self":  return "🫧"
        default:              return "·"
        }
    }

    /// Emoji indicator for overall rating.
    static func ratingEmoji(_ rating: String?) -> String {
        switch rating {
        case "excellent":        return "⭐️"
        case "good":             return "✨"
        case "fair":             return "·"
        case "needs_attention":  return "⚠️"
        default:                 return "·"
        }
    }

    /// Human-friendly relative date label for reservation rows.
    /// "Today", "Tomorrow", "In 3 days · Wed Apr 30", "Apr 22 · 5 days ago"
    static func relativeDateLabel(_ date: Date, now: Date = Date()) -> String {
        let cal = Calendar.current
        let startOfDay = cal.startOfDay(for: date)
        let startOfNow = cal.startOfDay(for: now)
        let days = cal.dateComponents([.day], from: startOfNow, to: startOfDay).day ?? 0

        let weekday = DateFormatter()
        weekday.dateFormat = "EEE MMM d"
        let dateLabel = weekday.string(from: date)

        switch days {
        case 0:                  return "Today · \(dateLabel)"
        case 1:                  return "Tomorrow · \(dateLabel)"
        case 2...6:              return "In \(days) days · \(dateLabel)"
        case 7...13:             return "Next week · \(dateLabel)"
        case let d where d > 13: return dateLabel
        case -1:                 return "Yesterday · \(dateLabel)"
        case let d where d < -1 && d >= -6: return "\(-d) days ago · \(dateLabel)"
        default:                 return dateLabel
        }
    }

    static func formatVaccineType(_ t: String) -> String {
        switch t {
        case "rabies":     return "Rabies"
        case "dapp":       return "DAPP"
        case "dhpp":       return "DHPP"
        case "bordetella": return "Bordetella"
        case "lepto":      return "Lepto"
        case "lyme":       return "Lyme"
        case "influenza":  return "Influenza"
        case "fvrcp":      return "FVRCP"
        case "other":      return "Other"
        default:           return t
        }
    }

    static func isExpired(_ date: String?, now: Date = Date()) -> Bool {
        guard let d = parseDate(date) else { return false }
        return d < now
    }

    static func isExpiringSoon(_ date: String?, days: Int = 30, now: Date = Date()) -> Bool {
        guard let d = parseDate(date) else { return false }
        let cutoff = Calendar.current.date(byAdding: .day, value: days, to: now) ?? now
        return d >= now && d <= cutoff
    }

    /// Human-friendly datetime in the device's locale.
    static func formatDateTime(_ value: String?, timezone: String? = nil) -> String {
        guard let date = parseDate(value) else { return "—" }
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        if let tz = timezone, let zone = TimeZone(identifier: tz) {
            f.timeZone = zone
        }
        return f.string(from: date)
    }

    /// Time only, e.g. "9:30 AM".
    static func formatTime(_ value: String?, timezone: String? = nil) -> String {
        guard let date = parseDate(value) else { return "—" }
        let f = DateFormatter()
        f.dateStyle = .none
        f.timeStyle = .short
        if let tz = timezone, let zone = TimeZone(identifier: tz) {
            f.timeZone = zone
        }
        return f.string(from: date)
    }
}
