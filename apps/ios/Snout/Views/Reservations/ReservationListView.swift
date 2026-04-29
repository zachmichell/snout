//
//  ReservationListView.swift
//  Snout
//
//  Card-per-visit list, grouped Upcoming / Past, with brand-tinted status badges.
//

import SwiftUI
import Supabase

@MainActor
final class ReservationListViewModel: ObservableObject {
    @Published var reservations: [Reservation] = []
    @Published var isLoading: Bool = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared
    private var realtimeChannel: RealtimeChannelV2?

    func load(ownerId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let rows: [Reservation] = try await client
                .from("reservations")
                .select()
                .eq("primary_owner_id", value: ownerId)
                .is("deleted_at", value: nil)
                .order("start_at", ascending: false)
                .limit(100)
                .execute()
                .value
            reservations = rows
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    func subscribeToRealtime(ownerId: String) async {
        if let channel = realtimeChannel {
            await channel.unsubscribe()
            realtimeChannel = nil
        }
        let channel = client.realtimeV2.channel("reservations:\(ownerId)")
        let changes = channel.postgresChange(
            AnyAction.self,
            schema: "public",
            table: "reservations"
        )
        await channel.subscribe()
        realtimeChannel = channel

        Task { [weak self] in
            for await _ in changes {
                guard let self else { break }
                await self.load(ownerId: ownerId)
            }
        }
    }

    func unsubscribe() async {
        if let channel = realtimeChannel {
            await channel.unsubscribe()
            realtimeChannel = nil
        }
    }
}

struct ReservationListView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = ReservationListViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                SnoutTheme.background.ignoresSafeArea()
                content
            }
            .navigationTitle("Visits")
            .navigationBarTitleDisplayMode(.large)
            .task {
                if let id = currentOwner.ownerId {
                    await vm.load(ownerId: id)
                    await vm.subscribeToRealtime(ownerId: id)
                }
            }
            .onDisappear { Task { await vm.unsubscribe() } }
            .refreshable {
                if let id = currentOwner.ownerId {
                    await vm.load(ownerId: id)
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let err = currentOwner.loadError {
            errorState(err)
        } else if vm.isLoading && vm.reservations.isEmpty {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let err = vm.loadError {
            errorState(err)
        } else if vm.reservations.isEmpty {
            emptyState
        } else {
            list
        }
    }

    private var list: some View {
        ScrollView {
            VStack(spacing: SnoutTheme.Spacing.xl) {
                if !upcoming.isEmpty {
                    section(title: "Upcoming", reservations: upcoming)
                }
                if !past.isEmpty {
                    section(title: "Past", reservations: past)
                }
                Spacer(minLength: SnoutTheme.Spacing.xxl)
            }
            .padding(.horizontal, SnoutTheme.Spacing.xl)
            .padding(.top, SnoutTheme.Spacing.md)
        }
        .scrollContentBackground(.hidden)
    }

    private var upcoming: [Reservation] {
        let now = Date()
        return vm.reservations
            .filter { $0.endAt >= now && $0.status != .cancelled && $0.status != .noShow }
            .sorted { $0.startAt < $1.startAt }
    }

    private var past: [Reservation] {
        let now = Date()
        return vm.reservations
            .filter { $0.endAt < now || $0.status == .cancelled || $0.status == .noShow }
            .sorted { $0.startAt > $1.startAt }
    }

    private func section(title: String, reservations: [Reservation]) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            Text(title.uppercased())
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .padding(.leading, SnoutTheme.Spacing.xs)
            VStack(spacing: SnoutTheme.Spacing.md) {
                ForEach(reservations) { r in
                    NavigationLink {
                        ReservationDetailView(reservation: r)
                    } label: {
                        ReservationCard(reservation: r)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            Image(systemName: "calendar")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(SnoutTheme.onSurfaceFaint)
            Text("No visits yet")
                .font(SnoutTheme.titleMD)
                .foregroundStyle(SnoutTheme.onSurface)
            Text("When your facility schedules a visit for your pet, it will show up here.")
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, SnoutTheme.Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundStyle(SnoutTheme.accent)
            Text("Couldn't load your visits")
                .font(SnoutTheme.titleMD)
                .foregroundStyle(SnoutTheme.onSurface)
            Text(message)
                .font(SnoutTheme.bodySM)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, SnoutTheme.Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ReservationCard: View {
    let reservation: Reservation

    var body: some View {
        HStack(alignment: .top, spacing: SnoutTheme.Spacing.lg) {
            dateTile

            VStack(alignment: .leading, spacing: 4) {
                Text(serviceLabel)
                    .font(SnoutTheme.titleSM)
                    .foregroundStyle(SnoutTheme.onSurface)
                Text(timeLabel)
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                SnoutBadge(
                    text: Money.formatReservationStatus(reservation.status.rawValue),
                    background: SnoutTheme.statusBackground(for: reservation.status),
                    foreground: SnoutTheme.statusForeground(for: reservation.status)
                )
                .padding(.top, 2)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(SnoutTheme.onSurfaceFaint)
                .padding(.top, 4)
        }
        .snoutCard()
    }

    private var dateTile: some View {
        VStack(spacing: 2) {
            Text(monthLabel.uppercased())
                .font(SnoutTheme.labelSM)
                .tracking(0.6)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            Text(dayLabel)
                .font(SnoutTheme.display(28, weight: .semibold))
                .foregroundStyle(SnoutTheme.onSurface)
            Text(weekdayLabel)
                .font(SnoutTheme.labelSM)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
        }
        .frame(width: 64, height: 64)
        .background(SnoutTheme.vanilla.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private var monthLabel: String {
        let f = DateFormatter()
        f.dateFormat = "MMM"
        return f.string(from: reservation.startAt)
    }

    private var dayLabel: String {
        let f = DateFormatter()
        f.dateFormat = "d"
        return f.string(from: reservation.startAt)
    }

    private var weekdayLabel: String {
        let f = DateFormatter()
        f.dateFormat = "EEE"
        return f.string(from: reservation.startAt)
    }

    private var serviceLabel: String {
        // Friendly service inference based on duration.
        let hours = reservation.endAt.timeIntervalSince(reservation.startAt) / 3600
        switch hours {
        case ..<2:    return "Appointment"
        case 2..<7:   return "Half day"
        case 7..<13:  return "Daycare day"
        case 13..<26: return "Overnight stay"
        default:      return "Multi-night stay"
        }
    }

    private var timeLabel: String {
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return "\(f.string(from: reservation.startAt)) – \(f.string(from: reservation.endAt))"
    }
}
