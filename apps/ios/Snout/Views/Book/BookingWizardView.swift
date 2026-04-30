//
//  BookingWizardView.swift
//  Snout
//
//  The four-step booking wizard surface. Renders the step indicator, the active
//  step's content, and the bottom Back/Continue/Submit controls. After successful
//  submit, swaps in a confirmation card with options to "Book another" or done.
//
//  This view assumes it's hosted inside the Book tab (see BookView). The Snout
//  custom tab bar stays visible throughout — we don't hide it here because the
//  wizard navigates step-to-step within a single screen rather than pushing
//  deeper navigation views.
//

import SwiftUI

struct BookingWizardView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = BookingWizardViewModel()
    @State private var didLoad: Bool = false

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                stepIndicator
                content
                bottomBar
            }
        }
        .task { await loadOnce() }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text("BOOK")
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            Text(headerTitle)
                .font(SnoutTheme.titleLG)
                .foregroundStyle(SnoutTheme.onSurface)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, SnoutTheme.Spacing.xl)
        .padding(.top, SnoutTheme.Spacing.xl)
        .padding(.bottom, SnoutTheme.Spacing.md)
    }

    private var headerTitle: String {
        if case .success = vm.submitState { return "Booking requested" }
        return "Schedule a visit"
    }

    // MARK: - Step indicator

    private var stepIndicator: some View {
        // Use effective steps so the indicator length matches the actual flow
        // (4 pills for non-grooming, 5 pills for grooming).
        let steps = vm.effectiveSteps
        let activeIndex = vm.currentEffectiveIndex
        return HStack(spacing: SnoutTheme.Spacing.xs) {
            ForEach(steps.indices, id: \.self) { i in
                Capsule()
                    .fill(i <= activeIndex ? SnoutTheme.accent : SnoutTheme.divider)
                    .frame(height: 4)
                    .animation(.easeInOut(duration: 0.2), value: vm.currentStep)
            }
        }
        .padding(.horizontal, SnoutTheme.Spacing.xl)
        .padding(.bottom, SnoutTheme.Spacing.lg)
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if case .success = vm.submitState {
            successView
        } else {
            ScrollView {
                VStack(spacing: 0) {
                    Group {
                        switch vm.currentStep {
                        case .service:  ServiceStep(vm: vm)
                        case .pets:     PetsStep(vm: vm)
                        case .dateTime: DateTimeStep(vm: vm)
                        case .groomer:  GroomerStep(vm: vm)
                        case .slot:     SlotPickerStep(vm: vm)
                        case .review:   ReviewStep(vm: vm)
                        }
                    }
                    .padding(.horizontal, SnoutTheme.Spacing.xl)
                }
                .padding(.bottom, SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
        }
    }

    private var successView: some View {
        VStack(spacing: SnoutTheme.Spacing.lg) {
            Spacer()
            ZStack {
                Circle()
                    .fill(SnoutTheme.cotton.opacity(0.7))
                    .frame(width: 88, height: 88)
                Image(systemName: "checkmark")
                    .font(.system(size: 36, weight: .semibold))
                    .foregroundStyle(SnoutTheme.accent)
            }
            VStack(spacing: SnoutTheme.Spacing.sm) {
                Text("Booking requested")
                    .font(SnoutTheme.titleLG)
                    .foregroundStyle(SnoutTheme.onSurface)
                Text("We've sent your request to your facility — they'll confirm shortly. You can track it in the Calendar tab.")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, SnoutTheme.Spacing.xl)
            }
            Button {
                vm.reset()
            } label: {
                Text("Book another visit")
                    .font(SnoutTheme.body(15, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onAccent)
                    .padding(.horizontal, SnoutTheme.Spacing.xl)
                    .padding(.vertical, SnoutTheme.Spacing.md)
                    .background(SnoutTheme.accent)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            Spacer()
        }
        .padding(.horizontal, SnoutTheme.Spacing.xl)
    }

    // MARK: - Bottom bar (Back / Continue / Submit)

    @ViewBuilder
    private var bottomBar: some View {
        if case .success = vm.submitState {
            EmptyView()
        } else {
            VStack(spacing: SnoutTheme.Spacing.sm) {
                if case let .error(msg) = vm.submitState {
                    Text(msg)
                        .font(SnoutTheme.bodySM)
                        .foregroundStyle(SnoutTheme.onSurface)
                        .padding(SnoutTheme.Spacing.md)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(SnoutTheme.cotton.opacity(0.6))
                        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
                }

                HStack(spacing: SnoutTheme.Spacing.md) {
                    if vm.currentStep != .service {
                        Button {
                            vm.back()
                        } label: {
                            Text("Back")
                                .font(SnoutTheme.body(15, weight: .semibold))
                                .foregroundStyle(SnoutTheme.onSurface)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, SnoutTheme.Spacing.md)
                                .background(SnoutTheme.surface)
                                .clipShape(Capsule())
                                .overlay(
                                    Capsule().stroke(SnoutTheme.divider, lineWidth: 1)
                                )
                        }
                        .buttonStyle(.plain)
                        .disabled(vm.submitState == .submitting)
                    }
                    primaryButton
                }
            }
            .padding(.horizontal, SnoutTheme.Spacing.xl)
            .padding(.vertical, SnoutTheme.Spacing.md)
        }
    }

    @ViewBuilder
    private var primaryButton: some View {
        if vm.currentStep == .review {
            Button {
                Task { await submit() }
            } label: {
                HStack(spacing: SnoutTheme.Spacing.sm) {
                    if vm.submitState == .submitting {
                        ProgressView().tint(SnoutTheme.onAccent)
                    }
                    Text(vm.submitState == .submitting ? "Submitting…" : "Request booking")
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onAccent)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, SnoutTheme.Spacing.md)
                .background(SnoutTheme.accent)
                .clipShape(Capsule())
                .opacity(vm.canSubmit ? 1 : 0.5)
            }
            .buttonStyle(.plain)
            .disabled(!vm.canSubmit)
        } else {
            Button {
                vm.next()
            } label: {
                Text("Continue")
                    .font(SnoutTheme.body(15, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, SnoutTheme.Spacing.md)
                    .background(SnoutTheme.accent)
                    .clipShape(Capsule())
                    .opacity(canContinue ? 1 : 0.5)
            }
            .buttonStyle(.plain)
            .disabled(!canContinue)
        }
    }

    private var canContinue: Bool {
        switch vm.currentStep {
        case .service:  return vm.canContinueFromService
        case .pets:     return vm.canContinueFromPets
        case .dateTime: return vm.canContinueFromDateTime
        case .groomer:  return vm.canContinueFromGroomer
        case .slot:     return vm.canContinueFromSlot
        case .review:   return false  // Submit handles it
        }
    }

    // MARK: - Actions

    private func loadOnce() async {
        guard !didLoad,
              let owner = currentOwner.ownerId,
              let org = currentOwner.organizationId else { return }
        didLoad = true
        await vm.loadInitialData(organizationId: org, ownerId: owner)
    }

    private func submit() async {
        guard let owner = currentOwner.ownerId,
              let org = currentOwner.organizationId else { return }
        let userId = currentOwner.owner?.profileId
        await vm.submit(ownerId: owner, organizationId: org, userId: userId)
    }
}

#Preview {
    BookingWizardView()
        .environmentObject(CurrentOwnerService())
}
