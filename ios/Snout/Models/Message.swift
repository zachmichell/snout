//
//  Message.swift
//  Snout
//
//  Mirrors the `messages` Postgres table. RLS verifies the sender is in the conversation.
//  Unread count from owner POV: read_at IS NULL AND sender_type != 'owner'.
//

import Foundation

enum MessageSenderType: String, Codable {
    case owner
    case staff
    case system
}

struct Message: Codable, Identifiable, Hashable {
    let id: String
    let conversationId: String
    let senderId: String
    let senderType: MessageSenderType
    let body: String
    let readAt: Date?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case conversationId  = "conversation_id"
        case senderId        = "sender_id"
        case senderType      = "sender_type"
        case body
        case readAt          = "read_at"
        case createdAt       = "created_at"
    }
}
