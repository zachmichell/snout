//
//  VisitDetailView.swift
//  Snout
//
//  Pushed from the calendar day-detail panel when a parent taps a visit
//  card. Shows full reservation context (service, pet, time, location,
//  notes) and exposes destructive actions:
//
//  - Cancel — always available for not-yet-completed reservations.
//    Compares now vs (start_at - cancellation_window_hours) and surfaces
//    a warning dialog about possible fees when the cancellation is "late".
//
//  - Edit (next turn) — non-grooming, future, requested-or-confirmed
//    reservations only. Per the user's spec, grooming appointments cannot
//    be edited (only cancelled) because groomer slots are harder to refill.
//
//  Cancellation behavior:
//    1. UPDATE reservations.status = 'cancelled', cancelled_at = NOW(),
//       cancelled_reason = (optional reason).
//    2. If grooming, ALSO UPDATE grooming_appointments.status = 'cancelled'
//       so the groomer's slot frees up immediately for the next booker.
//

import SwiftUI

@MainActor
final class VisitDetailViewModel: ObservableObject {
    @Published var isCancelling: Bool = false
    @Published var cancelError: String?
    /// Set after a successful cancellation so the parent view can pop back.
    @Published var didCancel: Bool = false

    private let client = SupabaseClientProvider.shared

    /// Cancel a reservation. If it's grooming, also cancel the linked
    /// grooming_appointments row (looked up by reservation_id).
    func cancel(reservation: Reservation, isGrooming: Bool, reason: String?) async {
        isCancelling = true
        defer { isCancelling = false }
        cancelError = nil

        struct CancelPayload: Encodable {
            let status: String
            let cancelled_at: String
            let cancelled_reason: String?
        }
        let payload = CancelPayload(
            status: "cancelled",
            cancelled_at: ISO8601DateFormatter().string(from: Date()),
            cancelled_reason: (reason?.isEmpty ?? true) ? nil : reason
        )

        do {
            try await client
                .from("reservations")
                .update(payload)
                .eq("id", value: reservation.id)
                .execute()

            if isGrooming {
                struct GroomingCancel: Encodable { let status: String }
                try await client
                    .from("grooming_appointments")
                    .update(GroomingCancel(status: "cancelled"))
                    .eq("reservation_id", value: reservation.id)
                    .execute()
            }

            didCancel = true
        } catch {
            cancelError = error.localizedDescription
        }
    }
}

struct VisitDetailView: View {
    let reservation: Reservation
    let serviceName: String
    let module: CalendarModule
    let pets: [Pet]
    let locationName: String?
    /// Cancellation policy in hours. Used to decide whether to show the late-
    /// cancellation warning.
    let cancellationHours: Int
    /// Optional callback the parent uses to refresh after a successful
    /// cancellation. Default is a no-op so callers that don't care can omit it.
    var onCancelled: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm = VisitDetailViewModel()

    @State private var showCancelConfirm = false
    @State private var showLateWarning = false
    @State private var cancelReason: String = ""

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
                    headerCard
                    detailsList
                    if let notes = reservation.notes, !notes.isEmpty {
                        notesCard(notes)
                    }
                    policyBanner
                    actions
                    if let err = vm.cancelError {
                        errorBanner(err)
                    }
                    Spacer(minLength: 80)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Visit details")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: vm.didCancel) { _, new in
            if new {
                onCancelled()
                dismiss()
            }
        }
        // Inside-the-window: stronger warning + reason field.
        .alert("Late cancellation", isPresented: $showLateWarning) {
            TextField("Reason (optional)", text: $cancelReason)
            Button("Cancel anyway", role: .destructive) {
                Task {
                    await vm.cancel(
                        reservation: reservation,
                        isGrooming: module == .grooming,
                        reason: cancelReason
                    )
                }
            }
            Button("Keep visit", role: .cancel) {}
        } message: {
            Text(lateWarningMessage)
        }
        // Outside-the-window: lighter "are you sure?" confirm.
        .alert("Cancel this visit?", isPresented: $showCancelConfirm) {
            Button("Cancel visit", role: .destructive) {
                Task {
                    await vm.cancel(
                        reservation: reservation,
                        isGrooming: module == .grooming,
                        reason: nil
                    )
                }
            }
            Button("Keep visit", role: .cancel) {}
        } message: {
            Text("This will tell your facility you're not coming. They may need to confirm any rebooking on their end.")
        }
    }

    // MARK: - Header

    private var headerCard: some View {
        HStack(spacing: 0) {
            Rectangle().fill(module.color).frame(width: 6)
            HStack(spacing: SnoutTheme.Spacing.md) {
                ZStack {
                    Circle().fill(SnoutTheme.surface).frame(width: 48, height: 48)
                    if let pet = pets.first {
                        Text(initials(for: pet.name))
                            .font(SnoutTheme.body(16, weight: .semibold))
                            .foregroundStyle(SnoutTheme.onSurface)
                    } else {
                        Image(systemName: "pawprint.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(module.color)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(serviceName)
                        .font(SnoutTheme.body(17, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                    if !pets.isEmpty {
                        Text(pets.map(\.name).joined(separator: ", "))
                            .font(SnoutTheme.bodySM)
                            .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    }
                }
                Spacer()
            }
            .padding(SnoutTheme.Spacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(module.color.opacity(0.18))
        }
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    // MARK: - Details list

    private var detailsList: some View {
        VStack(spacing: 0) {
            detailRow(label: "When", value: dateLabel)
            Divider().background(SnoutTheme.divider)
            detailRow(label: "Status", value: statusLabel(reservation.status))
            if let locationName {
                Divider().background(SnoutTheme.divider)
                detailRow(label: "Location", value: locationName)
            }
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private func detailRow(label: String, value: String) -> some View {
        HStack(alignment: .top) {
            Text(label.uppercased())
                .font(SnoutTheme.labelSM)
                .tracking(0.6)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .frame(width: 80, alignment: .leading)
            Text(value)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
            Spacer()
        }
        .padding(.vertical, SnoutTheme.Spacing.sm)
    }

    private func notesCard(_ notes: String) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text("NOTES")
                .font(SnoutTheme.labelSM)
                .tracking(0.6)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            Text(notes)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    // MARK: - Cancellation policy banner

    private var policyBanner: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("CANCELLATION POLICY")
                .font(SnoutTheme.labelSM)
                .tracking(0.6)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            Text(policyExplanation)
                .font(SnoutTheme.bodySM)
                .foregroundStyle(SnoutTheme.onSurface)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(SnoutTheme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isLateCancellation ? SnoutTheme.cotton.opacity(0.5) : SnoutTheme.background)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
    }

    private var policyExplanation: String {
        let kind = module == .grooming ? "Grooming" : "Reservation"
        if isLateCancellation {
            return "\(kind) cancellations within \(cancellationHours) hours of the start time may be charged a fee per the facility's policy."
        }
        return "Cancellations made more than \(cancellationHours) hours before the start time are free of charge per the facility's policy."
    }

    /// True when the reservation starts within the cancellation window.
    private var isLateCancellation: Bool {
        let now = Date()
        let cutoff = reservation.startAt.addingTimeInterval(-Double(cancellationHours) * 3600)
        return now > cutoff && now < reservation.startAt
    }

    private var isPast: Bool { reservation.startAt < Date() }

    private var canCancel: Bool {
        // Already cancelled or completed → no-op.
        switch reservation.status {
        case .cancelled, .checkedOut, .noShow: return false
        case .checkedIn:                       return false  // already at the facility
        case .requested, .confirmed:           return !isPast
        }
    }

    // MARK: - Actions

    @ViewBuilder
    private var actions: some View {
        VStack(spacing: SnoutTheme.Spacing.sm) {
            // Edit button — placeholder for next turn. Disabled for grooming
            // per spec, also disabled in past/non-editable states.
            if module != .grooming, canCancel {
                Button {
                    // TODO: present the edit flow next turn.
                } label: {
                    Text("Edit visit")
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, SnoutTheme.Spacing.md)
                        .background(SnoutTheme.surface)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SnoutTheme.divider, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(true) // Wired in the follow-up turn.
                .opacity(0.5)
            }

            if canCancel {
                Button {
                    if isLateCancellation {
                        showLateWarning = true
                    } else {
                        showCancelConfirm = true
                    }
                } label: {
                    HStack(spacing: SnoutTheme.Spacing.sm) {
                        if vm.isCancelling { ProgressView().tint(.white) }
                        Text(vm.isCancelling ? "Cancelling…" : "Cancel visit")
                            .font(SnoutTheme.body(15, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, SnoutTheme.Spacing.md)
                    .background(Color.red.opacity(0.85))
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(vm.isCancelling)
            }
        }
    }

    // MARK: - Helpers

    private var lateWarningMessage: String {
        let hrs = hoursUntilStart()
        let kind = module == .grooming ? "grooming appointment" : "visit"
        return "Your \(kind) starts in \(formatHours(hrs)). The facility's policy may charge a cancellation fee for \(kind)s cancelled less than \(cancellationHours) hours ahead. Continue?"
    }

    private func hoursUntilStart() -> Double {
        max(0, reservation.startAt.timeIntervalSinceNow / 3600)
    }

    private func formatHours(_ h: Double) -> String {
        if h < 1 { return "less than an hour" }
        let rounded = Int(h.rounded())
        return rounded == 1 ? "1 hour" : "\(rounded) hours"
    }

    private var dateLabel: String {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "America/Regina") ?? .current
        f.dateFormat = "EEE MMM d, h:mm a"
        let endFmt = DateFormatter()
        endFmt.timeZone = f.timeZone
        endFmt.dateFormat = "h:mm a"
        return "\(f.string(from: reservation.startAt)) – \(endFmt.string(from: reservation.endAt))"
    }

    private func statusLabel(_ s: ReservationStatus) -> String {
        switch s {
        case .requested:    return "Requested"
        case .confirmed:    return "Confirmed"
        case .checkedIn:    return "Checked in"
        case .checkedOut:   return "Checked out"
        case .cancelled:    return "Cancelled"
        case .noShow:       return "No show"
        }
    }

    private func initials(for name: String) -> String {
        let parts = name.split(separator: " ").prefix(2)
        let first = parts.compactMap { $0.first.map(String.init) }
        return first.joined().uppercased()
    }

    private func errorBanner(_ message: String) -> some View {
        Text(message)
            .font(SnoutTheme.bodySM)
            .foregroundStyle(SnoutTheme.onSurface)
            .padding(SnoutTheme.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SnoutTheme.cotton.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
    }
}
