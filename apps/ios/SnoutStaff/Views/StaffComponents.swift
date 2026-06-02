//
//  StaffComponents.swift
//  Snout Staff
//
//  Small Boho-styled form primitives for the staff app, so it doesn't depend
//  on the client app's view files. Mirrors the look of BohoFormField in the
//  client's MoreShared.swift.
//

import SwiftUI
import UIKit

struct StaffFormField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""
    var contentType: UITextContentType? = nil
    var keyboard: UIKeyboardType = .default
    var capitalization: TextInputAutocapitalization = .sentences

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text(label)
                .font(SnoutTheme.labelSM)
                .tracking(0.4)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            TextField(placeholder, text: $text)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
                .textContentType(contentType)
                .keyboardType(keyboard)
                .textInputAutocapitalization(capitalization)
                .autocorrectionDisabled(keyboard == .emailAddress)
                .padding(.horizontal, SnoutTheme.Spacing.md)
                .padding(.vertical, SnoutTheme.Spacing.sm)
                .background(SnoutTheme.background)
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous)
                        .stroke(SnoutTheme.divider, lineWidth: 1)
                )
        }
    }
}

struct StaffMultilineField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text(label)
                .font(SnoutTheme.labelSM)
                .tracking(0.4)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(2...6)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
                .padding(.horizontal, SnoutTheme.Spacing.md)
                .padding(.vertical, SnoutTheme.Spacing.sm)
                .background(SnoutTheme.background)
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous)
                        .stroke(SnoutTheme.divider, lineWidth: 1)
                )
        }
    }
}

struct StaffSecureField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text(label)
                .font(SnoutTheme.labelSM)
                .tracking(0.4)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            SecureField(placeholder, text: $text)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
                .textContentType(.password)
                .padding(.horizontal, SnoutTheme.Spacing.md)
                .padding(.vertical, SnoutTheme.Spacing.sm)
                .background(SnoutTheme.background)
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous)
                        .stroke(SnoutTheme.divider, lineWidth: 1)
                )
        }
    }
}

// MARK: - Boho avatar (name-seeded; six palette tones)

/// Circular initial avatar — backs every pet/owner row across the staff lanes
/// so the Boho palette repeats consistently. Hue is hashed from the name so
/// each pet/owner gets a stable color across screens. Pass `symbolFallback`
/// for the empty case (no name at all).
struct StaffAvatar: View {
    let name: String?
    var size: CGFloat = 40
    var symbolFallback: String? = nil

    var body: some View {
        ZStack {
            Circle().fill(tint).frame(width: size, height: size)
            if let label = initial {
                Text(label)
                    .font(SnoutTheme.body(size * 0.4, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
            } else if let symbol = symbolFallback {
                Image(systemName: symbol)
                    .font(.system(size: size * 0.45, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
            }
        }
    }

    private var tint: Color {
        guard let name, !name.isEmpty else { return SnoutTheme.vanilla.opacity(0.7) }
        return Self.boho(forName: name)
    }

    private var initial: String? {
        guard let n = name?.trimmingCharacters(in: .whitespaces),
              let first = n.first else { return nil }
        return String(first).uppercased()
    }

    /// Stable name-seeded Boho hue. Public so callers can match a card tint
    /// to the avatar (e.g. hero card behind the same pet's avatar).
    static func boho(forName name: String) -> Color {
        let palette: [Color] = [
            SnoutTheme.cotton, SnoutTheme.vanilla, SnoutTheme.frost,
            SnoutTheme.mist, SnoutTheme.blueberry
        ]
        let key = name.isEmpty ? "?" : name
        let hash = abs(key.hashValue)
        return palette[hash % palette.count].opacity(0.85)
    }
}

// MARK: - Status badge factories (palette-mapped, never raw red/green)

func staffStatusLabel(_ status: ReservationStatus) -> String {
    switch status {
    case .requested:  return "Requested"
    case .confirmed:  return "Confirmed"
    case .checkedIn:  return "Checked in"
    case .checkedOut: return "Checked out"
    case .cancelled:  return "Cancelled"
    case .noShow:     return "No-show"
    }
}

/// Reservation status pill — uses the shared SnoutTheme status mapping so
/// schedule/dashboard/grooming all read the same.
struct StaffReservationBadge: View {
    let status: ReservationStatus
    var body: some View {
        SnoutBadge(text: staffStatusLabel(status),
                   background: SnoutTheme.statusBackground(for: status),
                   foreground: SnoutTheme.statusForeground(for: status))
    }
}

/// Grooming uses free-text statuses (requested / confirmed / checked_in /
/// in_progress / completed / cancelled / scheduled). Map them to the same
/// palette tones the reservation pills use so the two lanes feel cohesive.
struct StaffGroomingBadge: View {
    let status: String
    var body: some View {
        SnoutBadge(text: label,
                   background: background,
                   foreground: foreground)
    }
    private var label: String {
        switch status {
        case "requested":   return "Requested"
        case "confirmed":   return "Confirmed"
        case "scheduled":   return "Scheduled"
        case "checked_in":  return "Checked in"
        case "in_progress": return "In progress"
        case "completed":   return "Completed"
        case "cancelled":   return "Cancelled"
        default:            return status.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
    private var background: Color {
        switch status {
        case "requested", "scheduled":    return SnoutTheme.vanilla.opacity(0.55)
        case "confirmed":                 return SnoutTheme.mist.opacity(0.65)
        case "checked_in", "in_progress": return SnoutTheme.cotton.opacity(0.85)
        case "completed":                 return SnoutTheme.frost.opacity(0.65)
        case "cancelled":                 return SnoutTheme.blueberry.opacity(0.30)
        default:                          return SnoutTheme.divider
        }
    }
    private var foreground: Color {
        status == "cancelled" ? SnoutTheme.onSurfaceMuted : SnoutTheme.onSurface
    }
}
