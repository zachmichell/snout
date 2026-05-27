//
//  Pet.swift
//  Snout
//
//  Mirrors the `pets` Postgres table. Pet parents reach pets via the pet_owners join table:
//  pet_owners.owner_id = your_owner_id, then join to pets.id.
//

import Foundation

enum Species: String, Codable {
    case dog
    case cat
    case other
}

enum Sex: String, Codable {
    case male = "M"
    case female = "F"
    case unknown = "U"
}

struct Pet: Codable, Identifiable, Hashable {
    let id: String
    let organizationId: String
    let name: String
    let species: Species
    let breed: String?
    let sex: Sex
    let dateOfBirth: String?
    let weightKg: Double?
    let color: String?
    let microchipId: String?
    let spayedNeutered: Bool?
    let photoURL: String?
    let allergies: String?
    let medicationNotes: String?
    let feedingNotes: String?
    let behavioralNotes: String?
    let temperamentTags: [String]
    let createdAt: Date
    let updatedAt: Date
    let deletedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case organizationId    = "organization_id"
        case name, species, breed, sex, color
        case dateOfBirth       = "date_of_birth"
        case weightKg          = "weight_kg"
        case microchipId       = "microchip_id"
        case spayedNeutered    = "spayed_neutered"
        case photoURL          = "photo_url"
        case allergies
        case medicationNotes   = "medication_notes"
        case feedingNotes      = "feeding_notes"
        case behavioralNotes   = "behavioral_notes"
        case temperamentTags   = "temperament_tags"
        case createdAt         = "created_at"
        case updatedAt         = "updated_at"
        case deletedAt         = "deleted_at"
    }
}

// MARK: - Structured care entries
//
// Mirrors `pet_feeding_schedules` / `pet_medications`. These are the
// multi-entry, structured counterpart to the pet's freeform
// feeding_notes / medication_notes (which the web app still keeps as
// general notes). A pet can have any number of feeding schedules and
// medications; both are scoped by organization + pet and soft-toggled
// via `is_active`.

struct PetFeedingSchedule: Codable, Identifiable, Hashable {
    let id: String
    let organizationId: String
    let petId: String
    let foodType: String
    let amount: String?
    let frequency: String?
    let timing: String?
    let instructions: String?
    let isActive: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case organizationId = "organization_id"
        case petId          = "pet_id"
        case foodType       = "food_type"
        case amount, frequency, timing, instructions
        case isActive       = "is_active"
    }
}

struct PetMedication: Codable, Identifiable, Hashable {
    let id: String
    let organizationId: String
    let petId: String
    let name: String
    let dosage: String?
    let frequency: String?
    let timing: String?
    let instructions: String?
    let isActive: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case organizationId = "organization_id"
        case petId          = "pet_id"
        case name, dosage, frequency, timing, instructions
        case isActive       = "is_active"
    }
}
