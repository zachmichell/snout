//
//  ServiceStep.swift
//  Snout — booking wizard step 1
//
//  Pick a location (multi-location orgs only) and a service.
//

import SwiftUI

struct ServiceStep: View {
    @ObservedObject var vm: BookingWizardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
            if vm.hasMultipleLocations {
                locationPicker
            }

            servicesList

            Spacer(minLength: SnoutTheme.Spacing.md)
        }
    }

    // MARK: - Location picker (multi-location only)

    private var locationPicker: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            Text("LOCATION")
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)

            Menu {
                ForEach(vm.locations) { loc in
                    Button(loc.name) {
                        vm.selectedLocationId = loc.id
                        // If service was for the old location, clear it.
                        if let svc = vm.selectedService, svc.locationId != nil, svc.locationId != loc.id {
                            vm.selectedService = nil
                        }
                    }
                }
            } label: {
                HStack {
                    Text(currentLocationName)
                        .font(SnoutTheme.bodyMD)
                        .foregroundStyle(SnoutTheme.onSurface)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                .padding(SnoutTheme.Spacing.md)
                .background(SnoutTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous)
                        .stroke(SnoutTheme.divider, lineWidth: 1)
                )
            }
        }
    }

    private var currentLocationName: String {
        guard let id = vm.selectedLocationId,
              let loc = vm.locations.first(where: { $0.id == id }) else {
            return "Select a location"
        }
        return loc.name
    }

    // MARK: - Services list

    @ViewBuilder
    private var servicesList: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            Text("CHOOSE A SERVICE")
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)

            if vm.isLoadingInitial {
                Text("Loading services…")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .padding(.vertical, SnoutTheme.Spacing.md)
            } else if vm.visibleServices.isEmpty {
                Text("No services available for booking right now.")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .padding(SnoutTheme.Spacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SnoutTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
            } else {
                VStack(spacing: SnoutTheme.Spacing.md) {
                    ForEach(vm.visibleServices) { svc in
                        serviceRow(svc)
                    }
                }
            }
        }
    }

    private func serviceRow(_ svc: Service) -> some View {
        let isSelected = vm.selectedService?.id == svc.id
        return Button {
            vm.selectedService = svc
            // If user picks a different service, reset downstream state to be safe.
            if !isSelected {
                vm.selectedPets = []
            }
        } label: {
            HStack(alignment: .top, spacing: SnoutTheme.Spacing.md) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: SnoutTheme.Spacing.sm) {
                        Text(svc.name)
                            .font(SnoutTheme.body(16, weight: .semibold))
                            .foregroundStyle(SnoutTheme.onSurface)
                        Text(BookingHelpers.formatDurationType(svc.durationType).uppercased())
                            .font(SnoutTheme.labelSM)
                            .tracking(0.6)
                            .foregroundStyle(SnoutTheme.onSurfaceMuted)
                            .padding(.horizontal, SnoutTheme.Spacing.sm)
                            .padding(.vertical, 3)
                            .background(SnoutTheme.background)
                            .clipShape(Capsule())
                    }
                    if let desc = svc.description, !desc.isEmpty {
                        Text(desc)
                            .font(SnoutTheme.bodySM)
                            .foregroundStyle(SnoutTheme.onSurfaceMuted)
                            .lineLimit(2)
                    }
                    HStack(spacing: 2) {
                        Text(Money.formatCents(svc.basePriceCents))
                            .font(SnoutTheme.body(14, weight: .semibold))
                            .foregroundStyle(SnoutTheme.onSurface)
                        Text(BookingHelpers.priceUnitLabel(durationType: svc.durationType))
                            .font(SnoutTheme.bodySM)
                            .foregroundStyle(SnoutTheme.onSurfaceMuted)
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
                    .stroke(isSelected ? SnoutTheme.accent : SnoutTheme.divider, lineWidth: isSelected ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
    }
}
