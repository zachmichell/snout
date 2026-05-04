//
//  Owner.swift
//  Snout
//
//  Mirrors the `owners` Postgres table. owners is per-organization; profiles.id =
//  auth.users.id and owners.profile_id links back. A single user can be an owner at
//  multiple organizations.
//
//  Address + communication-preference columns are loaded so the More → Client
//  details edit screen can display and update them. All address fields are
//  nullable in the schema. communication_preference has a NOT NULL default of
//  'email' — kept as a non-optional String here to match the wire shape.
//

import Foundation

struct Owner: Codable, Identifiable, Hashable {
    let id: String
    let organizationId: String
    let profileId: String?
    let firstName: String
    let lastName: String
    let email: String?
    let phone: String?
    let streetAddress: String?
    let city: String?
    let stateProvince: String?
    let postalCode: String?
    /// 'email' | 'sms' | 'both' — Postgres `communication_pref` enum.
    let communicationPreference: String
    let notes: String?
    let storeCreditCents: Int
    let daycareFullDayCredits: Int
    let daycareHalfDayCredits: Int
    let boardingNightCredits: Int
    let createdAt: Date
    let updatedAt: Date
    let deletedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case organizationId          = "organization_id"
        case profileId               = "profile_id"
        case firstName               = "first_name"
        case lastName                = "last_name"
        case email, phone
        case streetAddress           = "street_address"
        case city
        case stateProvince           = "state_province"
        case postalCode              = "postal_code"
        case communicationPreference = "communication_preference"
        case notes
        case storeCreditCents        = "store_credit_cents"
        case daycareFullDayCredits   = "daycare_full_day_credits"
        case daycareHalfDayCredits   = "daycare_half_day_credits"
        case boardingNightCredits    = "boarding_night_credits"
        case createdAt               = "created_at"
        case updatedAt               = "updated_at"
        case deletedAt               = "deleted_at"
    }

    var fullName: String { "\(firstName) \(lastName)" }
}
