//
//  Money.swift
//  Snout
//
//  Web parity: src/lib/money.ts
//  Both implementations must satisfy the same inputs and outputs.
//
//  Cents-based math + currency formatting. Currency is per-organization (set at signup).
//  Don't ask the user to choose currency at the iOS layer.
//

import Foundation

enum Money {
    /// `formatCents(cents, "CAD")` → "$52.50 CAD"
    /// Mirrors the web app's deliberately simple format. Not using NumberFormatter.currency
    /// because the web app's representation is "$<value> <code>" and parity is the goal.
    static func formatCents(_ cents: Int?, currency: String = "CAD") -> String {
        let value = Double(cents ?? 0) / 100.0
        return String(format: "$%.2f %@", value, currency)
    }

    /// `formatCentsShort(cents)` → "$52.50"
    static func formatCentsShort(_ cents: Int?) -> String {
        let value = Double(cents ?? 0) / 100.0
        return String(format: "$%.2f", value)
    }

    /// Parse a user-entered dollar amount like "52.50" into integer cents (5250).
    /// Returns nil on invalid input.
    static func parseDollarsToCents(_ input: String) -> Int? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        guard let n = Double(trimmed), n.isFinite, n >= 0 else { return nil }
        return Int((n * 100).rounded())
    }

    /// `centsToDollarString(cents)` → "52.50" (or "" when cents is nil)
    static func centsToDollarString(_ cents: Int?) -> String {
        guard let cents else { return "" }
        let value = Double(cents) / 100.0
        return String(format: "%.2f", value)
    }

    static func formatDurationType(_ t: String) -> String {
        switch t {
        case "hourly":      return "Hourly"
        case "half_day":    return "Half Day"
        case "full_day":    return "Full Day"
        case "overnight":   return "Overnight"
        case "multi_night": return "Multi-Night"
        default:            return t
        }
    }

    static func formatModule(_ m: String) -> String {
        switch m {
        case "daycare":  return "Daycare"
        case "boarding": return "Boarding"
        case "grooming": return "Grooming"
        case "training": return "Training"
        case "retail":   return "Retail"
        default:         return m
        }
    }

    static func formatReservationStatus(_ s: String) -> String {
        switch s {
        case "requested":    return "Requested"
        case "confirmed":    return "Confirmed"
        case "checked_in":   return "Checked In"
        case "checked_out":  return "Checked Out"
        case "cancelled":    return "Cancelled"
        case "no_show":      return "No Show"
        default:             return s
        }
    }
}
