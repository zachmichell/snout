//
//  ReportCard.swift
//  Snout
//
//  Mirrors the `report_cards` Postgres table. Photos are storage paths in photo_urls[];
//  signed URLs are minted client-side via supabase.storage.createSignedUrls(paths, 3600).
//

import Foundation

struct ReportCard: Codable, Identifiable, Hashable {
    let id: String
    let organizationId: String
    let petId: String
    let reservationId: String
    let summary: String?
    let mood: String?
    let energyLevel: String?
    let appetite: String?
    let sociability: String?
    let overallRating: String?
    let photoURLs: [String]    // storage paths, NOT public URLs
    /// Filled custom sections, present when the card was authored from a
    /// report-card template (see report_cards.custom_sections). nil for
    /// classic cards, which use the fixed fields above.
    let customSections: [ReportCardSection]?
    let published: Bool
    let publishedAt: Date?
    let createdAt: Date
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case organizationId  = "organization_id"
        case petId           = "pet_id"
        case reservationId   = "reservation_id"
        case summary, mood
        case energyLevel     = "energy_level"
        case appetite, sociability
        case overallRating   = "overall_rating"
        case photoURLs       = "photo_urls"
        case customSections  = "custom_sections"
        case published
        case publishedAt     = "published_at"
        case createdAt       = "created_at"
        case updatedAt       = "updated_at"
    }
}

// MARK: - Templated custom sections

struct ReportCardSection: Codable, Hashable {
    let title: String
    let fields: [ReportCardField]

    enum CodingKeys: String, CodingKey { case title, fields }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        fields = (try? c.decode([ReportCardField].self, forKey: .fields)) ?? []
    }
}

struct ReportCardField: Codable, Hashable {
    let label: String
    let type: String
    let value: ReportCardFieldValue

    enum CodingKeys: String, CodingKey { case label, type, value }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = (try? c.decode(String.self, forKey: .label)) ?? ""
        type = (try? c.decode(String.self, forKey: .type)) ?? "text"
        value = (try? c.decode(ReportCardFieldValue.self, forKey: .value)) ?? .none
    }

    /// Owner-facing rendering of the captured value, mirroring the web's
    /// formatFieldValue (Yes/No, ★ rating, plain text).
    var displayValue: String {
        switch type {
        case "boolean":
            switch value {
            case .bool(let b): return b ? "Yes" : "No"
            default:           return "—"
            }
        case "rating":
            let n: Int
            switch value {
            case .number(let d): n = Int(d)
            default:             n = 0
            }
            guard n > 0 else { return "—" }
            return String(repeating: "★", count: n) + String(repeating: "☆", count: max(0, 5 - n))
        default:
            let s = value.stringValue
            return s.trimmingCharacters(in: .whitespaces).isEmpty ? "—" : s
        }
    }
}

/// Heterogeneous JSON value for a templated field: string, number, bool, or null.
enum ReportCardFieldValue: Codable, Hashable {
    case text(String)
    case number(Double)
    case bool(Bool)
    case none

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .none
        } else if let b = try? c.decode(Bool.self) {
            self = .bool(b)
        } else if let d = try? c.decode(Double.self) {
            self = .number(d)
        } else if let s = try? c.decode(String.self) {
            self = .text(s)
        } else {
            self = .none
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .text(let s):   try c.encode(s)
        case .number(let d): try c.encode(d)
        case .bool(let b):   try c.encode(b)
        case .none:          try c.encodeNil()
        }
    }

    var stringValue: String {
        switch self {
        case .text(let s):   return s
        case .number(let d): return d == d.rounded() ? String(Int(d)) : String(d)
        case .bool(let b):   return b ? "Yes" : "No"
        case .none:          return ""
        }
    }
}
