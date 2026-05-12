//
//  Location.swift
//  Snout
//
//  Mirrors the `locations` Postgres table. Locations are sub-units of an
//  organization (a single business can have multiple physical locations,
//  e.g. east-side kennel + west-side daycare). Reservations and webcams
//  reference a specific `location_id`.
//

import Foundation

struct Location: Codable, Identifiable, Hashable {
    let id: String
    let organizationId: String
    let name: String
    let streetAddress: String?
    let city: String?
    let stateProvince: String?
    let postalCode: String?
    let country: String?
    let phone: String?
    let email: String?
    let active: Bool
    let createdAt: Date
    let updatedAt: Date
    let deletedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, name, country, phone, email, active
        case organizationId = "organization_id"
        case streetAddress  = "street_address"
        case city
        case stateProvince  = "state_province"
        case postalCode     = "postal_code"
        case createdAt      = "created_at"
        case updatedAt      = "updated_at"
        case deletedAt      = "deleted_at"
    }

    /// Single-line address for compact UI: "123 Dogwood Drive, Saskatoon SK".
    /// Drops empty parts gracefully so a partially-populated location still reads cleanly.
    var formattedAddressOneLine: String? {
        var parts: [String] = []
        if let s = streetAddress?.trimmed, !s.isEmpty { parts.append(s) }
        var locale: [String] = []
        if let c = city?.trimmed, !c.isEmpty { locale.append(c) }
        if let sp = stateProvince?.trimmed, !sp.isEmpty { locale.append(sp) }
        if !locale.isEmpty {
            // "Saskatoon SK" — single space between city and state for compactness.
            parts.append(locale.joined(separator: " "))
        }
        guard !parts.isEmpty else { return nil }
        return parts.joined(separator: ", ")
    }

    /// Just the street number + street name. Used in the home-screen header where
    /// the city/state would be redundant for a parent who already knows the area.
    /// Falls back to nil when no street_address is on file.
    var streetLine: String? {
        guard let s = streetAddress?.trimmed, !s.isEmpty else { return nil }
        return s
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
