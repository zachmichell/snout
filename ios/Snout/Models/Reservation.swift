//
//  Reservation.swift
//  Snout
//
//  Mirrors the `reservations` Postgres table. Pet parents read by primary_owner_id.
//  Note: deleted_at must be filtered explicitly (.is("deleted_at", null)) — RLS does NOT
//  automatically hide soft-deleted rows.
//

import Foundation

enum ReservationStatus: String, Codable, CaseIterable {
    case requested
    case confirmed
    case checkedIn   = "checked_in"
    case checkedOut  = "checked_out"
    case cancelled
    case noShow      = "no_show"
}

enum ReservationSource: String, Codable {
    case staffCreated   = "staff_created"
    case ownerSelfServe = "owner_self_serve"
}

struct Reservation: Codable, Identifiable, Hashable {
    let id: String
    let organizationId: String
    let primaryOwnerId: String?
    let serviceId: String?
    let locationId: String?
    let suiteId: String?
    let status: ReservationStatus
    let source: ReservationSource
    let startAt: Date
    let endAt: Date
    let confirmedAt: Date?
    let checkedInAt: Date?
    let checkedOutAt: Date?
    let cancelledAt: Date?
    let cancelledReason: String?
    let notes: String?
    let isRecurring: Bool
    let createdAt: Date
    let updatedAt: Date
    let deletedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case organizationId   = "organization_id"
        case primaryOwnerId   = "primary_owner_id"
        case serviceId        = "service_id"
        case locationId       = "location_id"
        case suiteId          = "suite_id"
        case status, source
        case startAt          = "start_at"
        case endAt            = "end_at"
        case confirmedAt      = "confirmed_at"
        case checkedInAt      = "checked_in_at"
        case checkedOutAt     = "checked_out_at"
        case cancelledAt      = "cancelled_at"
        case cancelledReason  = "cancelled_reason"
        case notes
        case isRecurring      = "is_recurring"
        case createdAt        = "created_at"
        case updatedAt        = "updated_at"
        case deletedAt        = "deleted_at"
    }
}
