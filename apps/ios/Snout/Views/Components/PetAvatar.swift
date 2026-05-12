//
//  PetAvatar.swift
//  Snout
//
//  Single source of truth for "circular pet avatar". Used everywhere a pet
//  appears next to its name — Pets list, Pet edit form, Home hero card,
//  Calendar visit cards, Visit detail header, Book pet-selection step.
//
//  Render priority:
//    1. AsyncImage of `pet.photo_url` when set.
//    2. Initial-letter fallback in a name-seeded Boho hue.
//    3. Optional SF Symbol fallback when there's no pet (empty state).
//
//  The fallback hue is hashed from the pet's name so each pet gets a
//  stable color across screens — Bear is always frost, Luna is always
//  blueberry, etc. Hash uses Swift's String.hashValue which is *not*
//  stable across app launches per Hashable contract, but consumer-side
//  consistency within a session is what matters here.
//

import SwiftUI

struct PetAvatar: View {
    let pet: Pet?
    var size: CGFloat = 44
    /// Glyph to render when pet is nil (e.g. empty-state hero). When pet
    /// exists this is ignored — we always show the photo or initial.
    var symbolFallback: String? = nil
    /// Override the fallback tile color. Default is the name-seeded hue.
    var tintOverride: Color? = nil

    var body: some View {
        ZStack {
            Circle()
                .fill(tile)
                .frame(width: size, height: size)
            content
                .frame(width: size, height: size)
                .clipShape(Circle())
        }
    }

    @ViewBuilder
    private var content: some View {
        if let pet = pet {
            if let urlString = pet.photoURL, let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure, .empty:
                        // Render initial under loading + on error so rows
                        // don't flash white.
                        initialView(for: pet)
                    @unknown default:
                        initialView(for: pet)
                    }
                }
            } else {
                initialView(for: pet)
            }
        } else if let symbolFallback {
            Image(systemName: symbolFallback)
                .font(.system(size: size * 0.45, weight: .semibold))
                .foregroundStyle(SnoutTheme.onSurface)
        } else {
            Color.clear
        }
    }

    private func initialView(for pet: Pet) -> some View {
        Text(initial(for: pet.name))
            .font(SnoutTheme.body(size * 0.4, weight: .semibold))
            .foregroundStyle(SnoutTheme.onSurface)
    }

    private func initial(for name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return String(trimmed.first.map(String.init)?.uppercased() ?? "?")
    }

    /// Background tile color. Pet present → name-seeded Boho hue (or the
    /// caller's override). Pet absent → vanilla.
    private var tile: Color {
        if let tintOverride { return tintOverride }
        if let pet = pet {
            return PetAvatar.tint(forName: pet.name)
        }
        return SnoutTheme.vanilla.opacity(0.7)
    }

    /// Public so callers can match a card's tinted background to the same
    /// hue when the avatar overlays a tinted region (e.g. hero cards that
    /// already have their own background — we just want a neutral surface
    /// for the avatar to sit on without color clash).
    static func tint(forName name: String) -> Color {
        let palette: [Color] = [
            SnoutTheme.cotton, SnoutTheme.vanilla, SnoutTheme.frost,
            SnoutTheme.mist, SnoutTheme.blueberry
        ]
        let key = name.isEmpty ? "?" : name
        let hash = abs(key.hashValue)
        return palette[hash % palette.count].opacity(0.85)
    }
}
