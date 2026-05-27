//
//  ServiceStep.swift
//  Snout — booking wizard step 1
//
//  Service-type-first selection. The parent picks a service *type* (Daycare,
//  Boarding, Grooming, Training…) first, then the specific service within
//  that type. Multi-location orgs pick a location above the chooser.
//

import SwiftUI

struct ServiceStep: View {
    @ObservedObject var vm: BookingWizardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
            if vm.hasMultipleLocations {
                locationPicker
            }

            if vm.isLoadingInitial {
                loadingState
            } else if vm.hasMultipleLocations && vm.selectedLocationId == nil {
                pickLocationPrompt
            } else if vm.visibleServices.isEmpty {
                emptyState
            } else if vm.selectedModule == nil {
                serviceTypeGrid
            } else {
                servicesForType
            }

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
                        // Service types available may differ per location.
                        vm.syncModuleSelection()
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

    // MARK: - Loading / empty

    private var loadingState: some View {
        Text("Loading services…")
            .font(SnoutTheme.bodyMD)
            .foregroundStyle(SnoutTheme.onSurfaceMuted)
            .padding(.vertical, SnoutTheme.Spacing.md)
    }

    private var pickLocationPrompt: some View {
        Text("Choose a location above to see what's available.")
            .font(SnoutTheme.bodyMD)
            .foregroundStyle(SnoutTheme.onSurfaceMuted)
            .padding(SnoutTheme.Spacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SnoutTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private var emptyState: some View {
        Text("No services available for booking right now.")
            .font(SnoutTheme.bodyMD)
            .foregroundStyle(SnoutTheme.onSurfaceMuted)
            .padding(SnoutTheme.Spacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SnoutTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    // MARK: - Step 1a: service-type grid

    private var serviceTypeGrid: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            Text("WHAT DO YOU NEED?")
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)

            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: SnoutTheme.Spacing.md),
                    GridItem(.flexible(), spacing: SnoutTheme.Spacing.md),
                ],
                spacing: SnoutTheme.Spacing.md
            ) {
                ForEach(vm.availableModules, id: \.self) { module in
                    serviceTypeCard(module)
                }
            }
        }
    }

    private func serviceTypeCard(_ module: String) -> some View {
        let info = ServiceTypeInfo.from(module)
        let count = vm.visibleServices.filter { $0.module == module }.count
        return Button {
            vm.selectModule(module)
        } label: {
            VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
                ZStack {
                    Circle()
                        .fill(SnoutTheme.cotton.opacity(0.6))
                        .frame(width: 44, height: 44)
                    Image(systemName: info.symbol)
                        .font(.system(size: 20, weight: .regular))
                        .foregroundStyle(SnoutTheme.onSurface)
                }
                Text(info.title)
                    .font(SnoutTheme.body(16, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                Text(count == 1 ? "1 option" : "\(count) options")
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
            .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
            .padding(SnoutTheme.Spacing.lg)
            .background(SnoutTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous)
                    .stroke(SnoutTheme.divider, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Step 1b: services within the chosen type

    private var servicesForType: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            // Chosen-type header with a Change affordance back to the grid.
            HStack(spacing: SnoutTheme.Spacing.sm) {
                let info = ServiceTypeInfo.from(vm.selectedModule ?? "")
                Image(systemName: info.symbol)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                Text(info.title.uppercased())
                    .font(SnoutTheme.labelSM)
                    .tracking(0.8)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                Spacer()
                Button {
                    vm.clearModuleSelection()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.left.arrow.right")
                            .font(.system(size: 11, weight: .semibold))
                        Text("Change")
                            .font(SnoutTheme.body(13, weight: .semibold))
                    }
                    .foregroundStyle(SnoutTheme.accent)
                }
                .buttonStyle(.plain)
            }

            VStack(spacing: SnoutTheme.Spacing.md) {
                ForEach(vm.servicesForSelectedModule) { svc in
                    serviceRow(svc)
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

// MARK: - Service-type display metadata

/// Maps a service `module` string to a friendly title + SF Symbol for the
/// service-type chooser. Unknown modules fall back to a title-cased label
/// and a generic paw glyph, so new modules still render sensibly.
private struct ServiceTypeInfo {
    let title: String
    let symbol: String

    static func from(_ module: String) -> ServiceTypeInfo {
        switch module {
        case "daycare":  return .init(title: "Daycare", symbol: "sun.max.fill")
        case "boarding": return .init(title: "Boarding", symbol: "moon.stars.fill")
        case "grooming": return .init(title: "Grooming", symbol: "scissors")
        case "training": return .init(title: "Training", symbol: "graduationcap.fill")
        default:
            let pretty = module.isEmpty
                ? "Service"
                : module.prefix(1).uppercased() + module.dropFirst()
            return .init(title: pretty, symbol: "pawprint.fill")
        }
    }
}
