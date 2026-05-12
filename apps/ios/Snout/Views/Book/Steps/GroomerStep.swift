//
//  GroomerStep.swift
//  Snout — booking wizard step (grooming flow only)
//
//  Pet parent picks which groomer they want for this appointment. Each row
//  shows the groomer's display name, bio, specialties, and which days of the
//  week they work. Tapping a row selects them; the next step is the slot
//  picker which calls `get_groomer_available_slots` for the picked groomer.
//

import SwiftUI

struct GroomerStep: View {
    @ObservedObject var vm: BookingWizardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
            Text("CHOOSE A GROOMER")
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)

            if vm.isLoadingInitial {
                Text("Loading groomers…")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            } else if vm.groomers.isEmpty {
                Text("No groomers are currently set up at this facility.")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .padding(SnoutTheme.Spacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SnoutTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
            } else {
                VStack(spacing: SnoutTheme.Spacing.md) {
                    ForEach(vm.groomers) { groomer in
                        groomerRow(groomer)
                    }
                }
            }
        }
    }

    private func groomerRow(_ groomer: Groomer) -> some View {
        let isSelected = vm.selectedGroomer?.id == groomer.id
        return Button {
            // Reset slot selection when groomer changes — different groomer,
            // different calendar.
            if vm.selectedGroomer?.id != groomer.id {
                vm.selectedSlot = nil
                vm.availableSlots = []
            }
            vm.selectedGroomer = groomer
        } label: {
            HStack(alignment: .top, spacing: SnoutTheme.Spacing.md) {
                // Initials avatar — placeholder for a future profile photo column.
                ZStack {
                    Circle()
                        .fill(SnoutTheme.mist.opacity(0.7))
                        .frame(width: 48, height: 48)
                    Text(initials(for: groomer.displayName))
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(groomer.displayName)
                        .font(SnoutTheme.body(16, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                    if let bio = groomer.bio, !bio.isEmpty {
                        Text(bio)
                            .font(SnoutTheme.bodySM)
                            .foregroundStyle(SnoutTheme.onSurfaceMuted)
                            .lineLimit(2)
                    }
                    if !groomer.workingDays.isEmpty {
                        Text("Works \(daysSummary(groomer.workingDays))")
                            .font(SnoutTheme.labelSM)
                            .foregroundStyle(SnoutTheme.onSurfaceFaint)
                    }
                }
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(SnoutTheme.accent)
                }
            }
            .padding(SnoutTheme.Spacing.lg)
            .background(isSelected ? SnoutTheme.cotton.opacity(0.5) : SnoutTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous)
                    .stroke(isSelected ? SnoutTheme.accent : SnoutTheme.divider,
                            lineWidth: isSelected ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func initials(for name: String) -> String {
        let parts = name.split(separator: " ").prefix(2)
        let chars = parts.compactMap { $0.first.map(String.init) }
        return chars.joined().uppercased()
    }

    /// Compact day-of-week summary: condense consecutive weekdays into "Mon–Fri",
    /// otherwise list short names.
    private func daysSummary(_ days: [String]) -> String {
        // Map to ordered weekday indices.
        let order: [String: Int] = [
            "sunday": 0, "monday": 1, "tuesday": 2, "wednesday": 3,
            "thursday": 4, "friday": 5, "saturday": 6
        ]
        let sorted = days
            .compactMap { order[$0.lowercased()] }
            .sorted()
        guard !sorted.isEmpty else { return "" }
        let short = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]

        // Detect the standard "Mon–Fri" or "Tue–Sat" runs.
        if sorted.count >= 3, sorted == Array(sorted.first!...sorted.last!) {
            return "\(short[sorted.first!])–\(short[sorted.last!])"
        }
        return sorted.map { short[$0] }.joined(separator: ", ")
    }
}
