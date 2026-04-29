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
        case published
        case publishedAt     = "published_at"
        case createdAt       = "created_at"
        case updatedAt       = "updated_at"
    }
}
