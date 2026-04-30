//
//  SlotPickerStep.swift
//  Snout — booking wizard step (grooming flow only)
//
//  Date picker on top, grid of available start times below. The grid is
//  populated from the SECURITY DEFINER `get_groomer_available_slots` RPC,
//  which respects:
//    • the groomer's working hours
//    • their max_appointments_per_day
//    • existing non-cancelled appointments
//  The customer never sees other parents' bookings — only the slot strings
//  the function chooses to return.
//

import SwiftUI

struct SlotPickerStep: View {
    @ObservedObject var vm: BookingWizardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
            // Groomer summary header — useful context after step 3.
            if let groomer = vm.selectedGroomer {
                groomerSummary(groomer)
            }

            calendarSection

            slotsSection

            estimateCard
        }
        // Whenever the groomer changes, refresh the *set of available dates*
        // (drives which days are tappable on the calendar). The cascading
        // task on dateRefreshKey then fires the slot fetch for the picked day.
        .task(id: vm.selectedGroomer?.id ?? "") {
            await vm.refreshAvailableDates()
        }
        .task(id: dateRefreshKey) {
            await vm.refreshSlots()
        }
    }

    /// Compact key that triggers a slot refresh whenever any input that
    /// affects available slots changes.
    private var dateRefreshKey: String {
        "\(vm.selectedGroomer?.id ?? "")|\(vm.date)|\(vm.selectedService?.id ?? "")"
    }

    // MARK: - Header

    private func groomerSummary(_ groomer: Groomer) -> some View {
        HStack(spacing: SnoutTheme.Spacing.md) {
            ZStack {
                Circle().fill(SnoutTheme.mist.opacity(0.7)).frame(width: 36, height: 36)
                Image(systemName: "scissors")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("WITH")
                    .font(SnoutTheme.labelSM)
                    .tracking(0.6)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                Text(groomer.displayName)
                    .font(SnoutTheme.body(15, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
            }
            Spacer()
        }
        .padding(SnoutTheme.Spacing.md)
        .background(SnoutTheme.background)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    // MARK: - Date

    /// Calendar grid that only enables dates where the groomer has an
    /// availability row. Replaces the old `DatePicker` which let you pick
    /// any future date regardless of the groomer's schedule.
    @ViewBuilder
    private var calendarSection: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text("PICK A DATE")
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)

            if vm.isLoadingDates {
                HStack(spacing: SnoutTheme.Spacing.sm) {
                    ProgressView().tint(SnoutTheme.accent)
                    Text("Loading availability…")
                        .font(SnoutTheme.bodyMD)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                .padding(SnoutTheme.Spacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(SnoutTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
            } else if vm.availableDates.isEmpty {
                Text("This groomer doesn't have any open dates in the next 90 days.")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .padding(SnoutTheme.Spacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SnoutTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
            } else {
                BookingCalendarGrid(
                    availableDates: vm.availableDates,
                    selectedDate: $vm.date
                )
            }
        }
    }

    // MARK: - Slots grid

    @ViewBuilder
    private var slotsSection: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            Text("AVAILABLE TIMES")
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)

            if vm.isLoadingSlots {
                HStack(spacing: SnoutTheme.Spacing.sm) {
                    ProgressView().tint(SnoutTheme.accent)
                    Text("Loading times…")
                        .font(SnoutTheme.bodyMD)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                .padding(SnoutTheme.Spacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(SnoutTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
            } else if vm.availableSlots.isEmpty {
                Text("No openings on this date. Try a different day.")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .padding(SnoutTheme.Spacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SnoutTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
            } else {
                let columns = [GridItem(.adaptive(minimum: 88), spacing: SnoutTheme.Spacing.sm)]
                LazyVGrid(columns: columns, spacing: SnoutTheme.Spacing.sm) {
                    ForEach(vm.availableSlots, id: \.self) { slot in
                        slotChip(slot)
                    }
                }
            }
        }
    }

    private func slotChip(_ slot: String) -> some View {
        let isSelected = vm.selectedSlot == slot
        return Button {
            vm.selectedSlot = slot
        } label: {
            Text(slotLabel(slot))
                .font(SnoutTheme.body(14, weight: .semibold))
                .foregroundStyle(isSelected ? SnoutTheme.onAccent : SnoutTheme.onSurface)
                .padding(.horizontal, SnoutTheme.Spacing.md)
                .padding(.vertical, SnoutTheme.Spacing.sm)
                .frame(maxWidth: .infinity)
                .background(isSelected ? SnoutTheme.accent : SnoutTheme.surface)
                .clipShape(Capsule())
                .overlay(
                    Capsule().stroke(
                        isSelected ? SnoutTheme.accent : SnoutTheme.divider,
                        lineWidth: 1
                    )
                )
        }
        .buttonStyle(.plain)
    }

    /// "08:30" → "8:30 AM"
    private func slotLabel(_ slot: String) -> String {
        let parts = slot.split(separator: ":")
        guard parts.count == 2,
              let h = Int(parts[0]),
              let m = Int(parts[1]) else { return slot }
        let period = h < 12 ? "AM" : "PM"
        let display = h % 12 == 0 ? 12 : h % 12
        return String(format: "%d:%02d %@", display, m, period)
    }

    // MARK: - Estimate

    private var estimateCard: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Estimated total")
                    .font(SnoutTheme.body(14, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                Text("Final price set when staff confirm.")
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
}
