//
//  Groomer.swift
//  Snout
//
//  Mirrors the `groomers` Postgres table. Each groomer is tied to an
//  organization and (optionally) to a staff profile. Pet parents pick a
//  groomer in step 3 of the grooming-specific booking flow; the slot picker
//  then calls `get_groomer_available_slots` to render only the times that
//  fit on this groomer's calendar.
//

import Foundation

struct Groomer: Codable, Identifiable, Hashable {
    let id: String
    let organizationId: String
    let staffMemberId: String?
    let displayName: String
    let bio: String?
    let workingDays: [String]            // ["Monday","Tuesday",...]
    let maxAppointmentsPerDay: Int
    let specialties: [String]
    let certifications: [String]
    let commissionRatePercent: Int?
    let status: String                   // "active" | (others)
    let createdAt: Date
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id, bio, specialties, certifications, status
        case organizationId         = "organization_id"
        case staffMemberId          = "staff_member_id"
        case displayName            = "display_name"
        case workingDays            = "working_days"
        case maxAppointmentsPerDay  = "max_appointments_per_day"
        case commissionRatePercent  = "commission_rate_percent"
        case createdAt              = "created_at"
        case updatedAt              = "updated_at"
    }
}
