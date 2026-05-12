//
//  BookingHelpers.swift
//  Snout
//
//  Web parity: apps/web/src/lib/booking.ts
//  Both implementations must produce the same outputs for the same inputs.
//  See docs/PARITY_LOG.md.
//
//  Booking helpers: time-slot generation, duration math, price estimates.
//  Pure functions — no Supabase, no SwiftUI. Deterministic so the iOS booking
//  wizard's preview matches what the web wizard would show.
//

import Foundation

struct BookingTimeSlot: Hashable {
    let value: String   // "HH:mm" — what we send to the DB / store in state
    let label: String   // "9:00 AM" — what we render in UI
}

enum BookingHelpers {
    /// Generate 15-minute time slots between [startHour, endHour] inclusive of
    /// both ends. The default 6→21 matches the web wizard.
    static func generateTimeSlots(startHour: Int = 6, endHour: Int = 21) -> [BookingTimeSlot] {
        var out: [BookingTimeSlot] = []
        for h in startHour...endHour {
            for m in stride(from: 0, to: 60, by: 15) {
                if h == endHour && m > 0 { break }
                let hh = String(format: "%02d", h)
                let mm = String(format: "%02d", m)
                let value = "\(hh):\(mm)"
                let period = h < 12 ? "AM" : "PM"
                let display = h % 12 == 0 ? 12 : h % 12
                out.append(.init(value: value, label: "\(display):\(mm) \(period)"))
            }
        }
        return out
    }

    /// Combine a yyyy-mm-dd date and HH:mm time into a Date in the current
    /// timezone (the user's local clock — same behavior as new Date(y, m, d, h, mi)
    /// on web).
    static func combineDateTime(dateStr: String, timeStr: String) -> Date? {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: "America/Regina") ?? .current
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return f.date(from: "\(dateStr) \(timeStr)")
    }

    /// Tomorrow as yyyy-mm-dd in the org's timezone.
    static func tomorrowISODate() -> String {
        let tz = TimeZone(identifier: "America/Regina") ?? .current
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = tz
        let tomorrow = cal.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        let f = DateFormatter()
        f.calendar = cal
        f.timeZone = tz
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: tomorrow)
    }

    /// Number of nights between two yyyy-mm-dd date strings. Returns 0 if either
    /// is empty or if checkOut <= checkIn.
    static func diffNights(checkIn: String, checkOut: String) -> Int {
        guard !checkIn.isEmpty, !checkOut.isEmpty else { return 0 }
        guard let a = combineDateTime(dateStr: checkIn, timeStr: "00:00"),
              let b = combineDateTime(dateStr: checkOut, timeStr: "00:00") else { return 0 }
        let seconds = b.timeIntervalSince(a)
        return max(0, Int((seconds / 86400.0).rounded()))
    }

    /// Estimate total price in integer cents. Mirror of estimatePriceCents in
    /// lib/booking.ts.
    static func estimatePriceCents(
        basePriceCents: Int,
        durationType: ServiceDurationType,
        petCount: Int,
        nights: Int = 1,
        hours: Int = 1
    ) -> Int {
        let pets = max(1, petCount)
        switch durationType {
        case .hourly:
            return basePriceCents * max(1, hours) * pets
        case .halfDay, .fullDay:
            return basePriceCents * pets
        case .overnight:
            return basePriceCents * pets
        case .multiNight:
            return basePriceCents * max(1, nights) * pets
        case .flat:
            // Per-appointment pricing — fixed price × pet count, no time component.
            return basePriceCents * pets
        }
    }

    /// "/hr", "/day", "/night", etc. — mirror of priceUnitLabel.
    static func priceUnitLabel(durationType: ServiceDurationType) -> String {
        switch durationType {
        case .hourly:     return "/hr"
        case .halfDay:    return "/half day"
        case .fullDay:    return "/day"
        case .overnight:  return "/night"
        case .multiNight: return "/night"
        case .flat:       return ""    // No suffix — flat price per appointment.
        }
    }

    /// Human-readable duration label: "Full day", "Hourly", "Overnight".
    static func formatDurationType(_ d: ServiceDurationType) -> String {
        switch d {
        case .hourly:     return "Hourly"
        case .halfDay:    return "Half day"
        case .fullDay:    return "Full day"
        case .overnight:  return "Overnight"
        case .multiNight: return "Multi-night"
        case .flat:       return "Per appointment"
        }
    }

    /// Default reservation duration in minutes for `.flat` services. Used to
    /// derive `end_at` from `start_at` when the user only picks a start time.
    /// Could become per-service configurable via a future
    /// `services.default_duration_minutes` column.
    static let flatServiceDefaultDurationMinutes = 60
}
