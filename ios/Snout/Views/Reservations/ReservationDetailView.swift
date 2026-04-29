//
//  ReservationDetailView.swift
//  Snout
//
//  Reservation detail. Hero with status, schedule timeline, notes card.
//

import SwiftUI

struct ReservationDetailView: View {
    let reservation: Reservation

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xl) {
                    statusHero
                    scheduleCard
                    if let notes = reservation.notes, !notes.isEmpty {
                        notesCard(notes)
                    }
                    metaCard
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(.horizontal, SnoutTheme.Spacing.xl)
                .padding(.top, SnoutTheme.Spacing.md)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Visit")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Status hero

    private var statusHero: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            SnoutBadge(
                text: Money.formatReservationStatus(reservation.status.rawValue),
                background: SnoutTheme.surface,
                foreground: SnoutTheme.onSurface
            )
            Text(serviceLabel)
                .font(SnoutTheme.titleLG)
                .foregroundStyle(SnoutTheme.onSurface)
            Text(Format.relativeDateLabel(reservation.startAt))
                .font(SnoutTheme.bodyLG)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
        }
        .padding(SnoutTheme.Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SnoutTheme.statusBackground(for: reservation.status))
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusHero, style: .continuous))
        .shadow(color: SnoutTheme.heroShadowColor,
                radius: SnoutTheme.heroShadowRadius, x: 0, y: SnoutTheme.heroShadowY)
    }

    private var serviceLabel: String {
        let hours = reservation.endAt.timeIntervalSince(reservation.startAt) / 3600
        switch hours {
        case ..<2:    return "Appointment"
        case 2..<7:   return "Half day"
        case 7..<13:  return "Daycare day"
        case 13..<26: return "Overnight stay"
        default:      return "Multi-night stay"
        }
    }

    // MARK: - Schedule

    private var scheduleCard: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            sectionHeader("Schedule")
            timelineRow(label: "Starts", value: formatted(reservation.startAt), filled: true)
            timelineRow(label: "Ends", value: formatted(reservation.endAt), filled: false)
            if let confirmed = reservation.confirmedAt {
                Divider().background(SnoutTheme.divider)
                timelineRow(label: "Confirmed", value: formatted(confirmed), filled: true, accent: true)
            }
            if let checkedIn = reservation.checkedInAt {
                Divider().background(SnoutTheme.divider)
                timelineRow(label: "Checked in", value: formatted(checkedIn), filled: true, accent: true)
            }
            if let checkedOut = reservation.checkedOutAt {
                Divider().background(SnoutTheme.divider)
                timelineRow(label: "Checked out", value: formatted(checkedOut), filled: true, accent: true)
            }
        }
        .snoutCard()
    }

    private func timelineRow(label: String, value: String, filled: Bool, accent: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline) {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                Circle()
                    .fill(accent ? SnoutTheme.accent : (filled ? SnoutTheme.onSurfaceFaint : SnoutTheme.divider))
                    .frame(width: 8, height: 8)
                Text(label)
                    .font(SnoutTheme.labelMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
            Spacer()
            Text(value)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
        }
    }

    // MARK: - Notes

    private func notesCard(_ notes: String) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            sectionHeader("Notes")
            Text(notes)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
        }
        .snoutTinted(SnoutTheme.cotton)
    }

    // MARK: - Meta

    private var metaCard: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            sectionHeader("Reference")
            Text(reservation.id)
                .font(SnoutTheme.mono(11))
                .foregroundStyle(SnoutTheme.onSurfaceFaint)
                .textSelection(.enabled)
        }
        .snoutCard()
    }

    private func sectionHeader(_ text: String) -> some View {
        Text(text.uppercased())
            .font(SnoutTheme.labelSM)
            .tracking(0.8)
            .foregroundStyle(SnoutTheme.onSurfaceMuted)
    }

    private func formatted(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: d)
    }
}
