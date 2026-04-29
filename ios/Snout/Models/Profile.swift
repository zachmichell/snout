//
//  Profile.swift
//  Snout
//
//  Mirrors the `profiles` Postgres table. profiles.id == auth.users.id.
//

import Foundation

struct Profile: Codable, Identifiable, Hashable {
    let id: String
    let email: String?
    let firstName: String?
    let lastName: String?
    let phone: String?
    let avatarURL: String?
    let createdAt: Date
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id, email
        case firstName    = "first_name"
        case lastName     = "last_name"
        case phone
        case avatarURL    = "avatar_url"
        case createdAt    = "created_at"
        case updatedAt    = "updated_at"
    }
}

struct Membership: Codable, Hashable {
    let organizationId: String
    let role: String
    let active: Bool

    enum CodingKeys: String, CodingKey {
        case organizationId = "organization_id"
        case role, active
    }
}
