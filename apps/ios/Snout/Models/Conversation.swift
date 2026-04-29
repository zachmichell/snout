//
//  Conversation.swift
//  Snout
//
//  Mirrors the `conversations` Postgres table. One conversation per owner-org pair.
//

import Foundation

struct Conversation: Codable, Identifiable, Hashable {
    let id: String
    let organizationId: String
    let ownerId: String
    let lastMessageAt: Date?
    let lastMessagePreview: String?
    let unreadOwner: Int
    let unreadStaff: Int
    let createdAt: Date
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case organizationId       = "organization_id"
        case ownerId              = "owner_id"
        case lastMessageAt        = "last_message_at"
        case lastMessagePreview   = "last_message_preview"
        case unreadOwner          = "unread_owner"
        case unreadStaff          = "unread_staff"
        case createdAt            = "created_at"
        case updatedAt            = "updated_at"
    }
}
