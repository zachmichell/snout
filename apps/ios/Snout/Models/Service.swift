//
//  Service.swift
//  Snout
//
//  Mirrors the `services` Postgres table. A service is a bookable offering at
//  an organization (or specific location): "daycare full day", "boarding night",
//  "1-hour grooming", etc. Pet parents pick one in the booking wizard.
//

import Foundation

enum ServiceDurationType: String, Codable, CaseIterable, Hashable {
    case hourly
    case halfDay     = "half_day"
    case fullDay     = "full_day"
    case overnight
    case multiNight  = "multi_night"
    /// Flat / per-appointment pricing. Used for grooming, nail trims, training
    /// sessions, etc. — the customer pays a fixed price regardless of how long
    /// the appointment takes. Booking wizard collects date + start time only;
    /// reservation `end_at` defaults to `start_at + 60 minutes`.
    case flat
}

struct Service: Codable, Identifiable, Hashable {
    let id: String
    let organizationId: String
    let locationId: String?
    let name: String
    let description: String?
    let durationType: ServiceDurationType
    let basePriceCents: Int
    let maxPetsPerBooking: Int?
    let module: String
    let active: Bool
    /// Default appointment length in minutes — used by the slot picker to
    /// reserve the right amount of time on the groomer's calendar. Nullable
    /// for services that don't need a duration. v2 will let per-groomer
    /// time-matrix rows override this.
    let defaultDurationMinutes: Int?
    let createdAt: Date
    let updatedAt: Date
    let deletedAt: Date?

    /// Convenience: does this service route through the grooming-specific flow
    /// (groomer pick → slot picker → grooming_appointments insert)?
    var isGroomingFlow: Bool { module == "grooming" }

    enum CodingKeys: String, CodingKey {
        case id, name, description, module, active
        case organizationId         = "organization_id"
        case locationId             = "location_id"
        case durationType           = "duration_type"
        case basePriceCents         = "base_price_cents"
        case maxPetsPerBooking      = "max_pets_per_booking"
        case defaultDurationMinutes = "default_duration_minutes"
        case createdAt              = "created_at"
        case updatedAt              = "updated_at"
        case deletedAt              = "deleted_at"
    }
}
