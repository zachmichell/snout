//
//  Owner.swift
//  Snout
//
//  Mirrors the `owners` Postgres table. owners is per-organization; profiles.id =
//  auth.users.id and owners.profile_id links back. A single user can be an owner at
//  multiple organizations.
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
