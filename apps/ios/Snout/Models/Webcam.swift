//
//  Webcam.swift
//  Snout
//
//  Mirrors the `webcams` Postgres table. Player kind is determined by source_kind:
//  hls/mp4 → AVPlayerViewController; iframe → WKWebView.
//

import Foundation

enum WebcamSourceKind: String, Codable {
    case hls
    case mp4
    case iframe
}

struct Webcam: Codable, Identifiable, Hashable {
    let id: String
    let organizationId: String
    let locationId: String?
    let name: String
    let description: String?
    let provider: String?
    let sourceKind: WebcamSourceKind
    let sourceURL: String
    let enabled: Bool
    let createdAt: Date
    let updatedAt: Date
    let deletedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case organizationId  = "organization_id"
        case locationId      = "location_id"
        case name, description, provider
        case sourceKind      = "source_kind"
        case sourceURL       = "source_url"
        case enabled
        case createdAt       = "created_at"
        case updatedAt       = "updated_at"
        case deletedAt       = "deleted_at"
    }
}
