//
//  PetsStep.swift
//  Snout — booking wizard step 2
//
//  Multi-select pet picker. Honors the service's max_pets_per_booking and
//  auto-selects the only pet (handled in the view-model on initial load).
//  Vaccination warnings are deliberately deferred for v1; web spec parity has
//  them and we'll add when the iOS vaccination flow lands.
//

import SwiftUI

struct PetsStep: View {
    @ObservedObject var vm: BookingWizardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
            if let max = vm.selectedService?.maxPetsPerBooking {
                Text("This service allows up to \(max) pet\(max == 1 ? "" : "s") per booking.")
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .padding(SnoutTheme.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SnoutTheme.background)
                    .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
            }

            if vm.pets.isEmpty {
                Text("You don't have any pets on file. Contact your facility to add your pets.")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .padding(SnoutTheme.Spacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SnoutTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
            } else {
                if vm.pets.count > 1 {
                    Text("\(vm.selectedPets.count) of \(vm.pets.count) selected")
                        .font(SnoutTheme.labelMD)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                VStack(spacing: SnoutTheme.Spacing.md) {
                    ForEach(vm.pets) { pet in
                        petRow(pet)
                    }
                }
            }
        }
    }

    private func petRow(_ pet: Pet) -> some View {
        let isSelected = vm.selectedPets.contains(where: { $0.id == pet.id })
        let max = vm.selectedService?.maxPetsPerBooking
        let atLimit = !isSelected && (max != nil) && vm.selectedPets.count >= (max ?? 0)

        return Button {
            if isSelected {
                vm.selectedPets.removeAll { $0.id == pet.id }
            } else if !atLimit {
                vm.selectedPets.append(pet)
            }
        } label: {
            HStack(spacing: SnoutTheme.Spacing.md) {
                ZStack {
                    Circle()
                        .fill(SnoutTheme.vanilla.opacity(0.7))
                        .frame(width: 44, height: 44)
                    Image(systemName: "pawprint.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(SnoutTheme.accent)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(pet.name)
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                    if let breed = pet.breed, !breed.isEmpty {
                        Text(breed)
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
                    .stroke(isSelected ? SnoutTheme.accent : SnoutTheme.divider,
                            lineWidth: isSelected ? 1.5 : 1)
            )
            .opacity(atLimit ? 0.5 : 1.0)
        }
        .buttonStyle(.plain)
        .disabled(atLimit)
    }
}
