//
//  ReviewStep.swift
//  Snout — booking wizard step 4
//
//  Summary of the user's choices, optional notes, and the Submit action.
//  Submit creates the reservation row and per-pet join rows. After success,
//  the wizard view shows a confirmation state (handled in BookingWizardView).
//

import SwiftUI

struct ReviewStep: View {
    @ObservedObject var vm: BookingWizardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
            summaryCard
            notesField
            estimateCard
        }
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            row(symbol: "sparkles", eyebrow: "Service", value: vm.selectedService?.name ?? "—")
            Divider().background(SnoutTheme.divider)
            row(symbol: "calendar", eyebrow: "When", value: dateLabel)
            if vm.isGroomingFlow, let groomer = vm.selectedGroomer {
                Divider().background(SnoutTheme.divider)
                row(symbol: "scissors", eyebrow: "Groomer", value: groomer.displayName)
            }
            Divider().background(SnoutTheme.divider)
            row(symbol: "pawprint.fill", eyebrow: "Pets", value: vm.selectedPets.map(\.name).joined(separator: ", "))
            if let loc = currentLocationName {
                Divider().background(SnoutTheme.divider)
                row(symbol: "mappin.and.ellipse", eyebrow: "Location", value: loc)
            }
        }
        .snoutCard()
    }

    private func row(symbol: String, eyebrow: String, value: String) -> some View {
        HStack(alignment: .top, spacing: SnoutTheme.Spacing.md) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(SnoutTheme.accent)
                .frame(width: 22, alignment: .center)
            VStack(alignment: .leading, spacing: 2) {
                Text(eyebrow.uppercased())
                    .font(SnoutTheme.labelSM)
                    .tracking(0.8)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                Text(value)
                    .font(SnoutTheme.body(15, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
    }

    private var notesField: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text("SPECIAL INSTRUCTIONS")
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            TextField(
                "Anything the staff should know? (optional)",
                text: $vm.notes,
                axis: .vertical
            )
            .lineLimit(3...5)
            .font(SnoutTheme.bodyMD)
            .foregroundStyle(SnoutTheme.onSurface)
            .padding(SnoutTheme.Spacing.md)
            .background(SnoutTheme.surface)
            .overlay(
                RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous)
                    .stroke(SnoutTheme.divider, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
        }
    }

    private var estimateCard: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Estimated total")
                    .font(SnoutTheme.body(14, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                Text("Final price set by staff when they confirm.")
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
            Spacer()
            Text(Money.formatCents(vm.estimatedPriceCents))
                .font(SnoutTheme.display(22, weight: .regular))
                .foregroundStyle(SnoutTheme.onSurface)
        }
        .snoutTinted(SnoutTheme.cotton)
    }

    // MARK: - Helpers

    private var currentLocationName: String? {
        guard let id = vm.selectedLocationId,
              let loc = vm.locations.first(where: { $0.id == id }) else { return nil }
        return loc.name
    }

    private var dateLabel: String {
        guard let svc = vm.selectedService else { return "—" }
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "America/Regina") ?? .current
        f.dateFormat = "EEE MMM d, h:mm a"

        // Grooming flow uses the slot picker — `vm.selectedSlot` is the source
        // of truth, not the durationType-driven `vm.startTime`.
        if vm.isGroomingFlow, let slot = vm.selectedSlot,
           let s = BookingHelpers.combineDateTime(dateStr: vm.date, timeStr: slot) {
            return f.string(from: s)
        }

        switch svc.durationType {
        case .overnight, .multiNight:
            guard let s = BookingHelpers.combineDateTime(dateStr: vm.date, timeStr: vm.startTime),
                  let e = BookingHelpers.combineDateTime(dateStr: vm.endDate, timeStr: vm.endTime.isEmpty ? "11:00" : vm.endTime) else { return "—" }
            return "\(f.string(from: s)) → \(f.string(from: e)) (\(vm.nights) night\(vm.nights == 1 ? "" : "s"))"
        case .hourly:
            guard let s = BookingHelpers.combineDateTime(dateStr: vm.date, timeStr: vm.startTime) else { return "—" }
            let e = Calendar.current.date(byAdding: .hour, value: vm.hours, to: s) ?? s
            let endTimeFmt = DateFormatter()
            endTimeFmt.timeZone = f.timeZone
            endTimeFmt.dateFormat = "h:mm a"
            return "\(f.string(from: s)) – \(endTimeFmt.string(from: e))"
        case .halfDay, .fullDay:
            guard let s = BookingHelpers.combineDateTime(dateStr: vm.date, timeStr: vm.startTime),
                  let e = BookingHelpers.combineDateTime(dateStr: vm.date, timeStr: vm.endTime) else { return "—" }
            let endTimeFmt = DateFormatter()
            endTimeFmt.timeZone = f.timeZone
            endTimeFmt.dateFormat = "h:mm a"
            return "\(f.string(from: s)) – \(endTimeFmt.string(from: e))"
        case .flat:
            // Per-appointment: only the start time is meaningful to the parent.
            // The facility sets the actual end when they confirm.
            guard let s = BookingHelpers.combineDateTime(dateStr: vm.date, timeStr: vm.startTime) else { return "—" }
            return f.string(from: s)
        }
    }
}
