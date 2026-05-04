//
//  Message.swift
//  Snout
//
//  Mirrors the `messages` Postgres table. RLS verifies the sender is in the
//  conversation. Unread count from owner POV: read_at IS NULL AND
//  sender_type != 'owner'.
//

import Foundation

enum MessageSenderType: String, Codable {
    case owner
    case staff
    case system
}

/// Attachment metadata stored as a JSON array on `messages.attachments`. The
/// shape matches the migration comment: each element is self-describing so
/// we can render images vs documents without extra DB lookups.
struct MessageAttachment: Codable, Hashable, Identifiable {
    /// Bucket-relative path so we can re-mint signed URLs / delete the
    /// object later if needed. Path convention is
    /// `{organization_id}/{conversation_id}/{epoch}-{filename}`.
    let path: String
    /// Pre-minted signed URL (one-week TTL by default). When this expires
    /// the iOS client falls back to fetching a fresh signed URL by path.
    let url: String
    let mimeType: String
    let sizeBytes: Int
    let name: String
    /// "image" | "document" — render hint, decided at upload time.
    let kind: String

    /// Stable id derived from path so SwiftUI ForEach is happy without a
    /// separate id field on the JSON.
    var id: String { path }

    var isImage: Bool { kind == "image" }
    var isDocument: Bool { kind == "document" }

    enum CodingKeys: String, CodingKey {
        case path, url, name, kind
        case mimeType  = "mime_type"
        case sizeBytes = "size_bytes"
    }
}

struct Message: Codable, Identifiable, Hashable {
    let id: String
    let conversationId: String
    let senderId: String
    let senderType: MessageSenderType
    let body: String
    let attachments: [MessageAttachment]
    let readAt: Date?
    let createdAt: Date

    /// Custom decoder so older rows (or rows where the column was missing
    /// pre-migration) don't fail to parse if `attachments` is absent.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id              = try c.decode(String.self, forKey: .id)
        conversationId  = try c.decode(String.self, forKey: .conversationId)
        senderId        = try c.decode(String.self, forKey: .senderId)
        senderType      = try c.decode(MessageSenderType.self, forKey: .senderType)
        body            = try c.decode(String.self, forKey: .body)
        attachments     = (try? c.decode([MessageAttachment].self, forKey: .attachments)) ?? []
        readAt          = try c.decodeIfPresent(Date.self, forKey: .readAt)
        createdAt       = try c.decode(Date.self, forKey: .createdAt)
    }

    enum CodingKeys: String, CodingKey {
        case id
        case conversationId  = "conversation_id"
        case senderId        = "sender_id"
        case senderType      = "sender_type"
        case body
        case attachments
        case readAt          = "read_at"
        case createdAt       = "created_at"
    }
}
