//
//  StaffDashboardView.swift
//  Snout Staff
//
//  Owner/admin/manager home: a glanceable snapshot of today — pending
//  requests, arrivals, in-house, departures — plus a preview of the
//  requests that still need confirming. Full analytics is a later phase;
//  this is the at-a-glance landing. Actions (confirm/check-in) live in the
//  Today (schedule) tab.
//

import SwiftUI
import Supabase

@MainActor
final class StaffDashboardViewModel: ObservableObject {
    @Published var rows: [ScheduleReservation] = []
    @Published var isLoading = false

    private let client = SupabaseClientProvider.shared
    private static let graph =
        "id, status, start_at, end_at, notes, service:services(id, name), owner:owners!primary_owner_id(id, first_name, last_name), reservation_pets(pet:pets(id, name, species))"

    private var startOfToday = Calendar.current.startOfDay(for: Date())
    private var endOfToday: Date { Calendar.current.date(byAdding: DateComponents(day: 1, second: -1), to: startOfToday) ?? Date() }

    func load(organizationId: String) async {
        isLoading = true
        defer { isLoading = false }
        let key = "dashboard_\(organizationId)_\(StaffCache.todayKey())"
        if rows.isEmpty, let cached = StaffCache.load([ScheduleReservation].self, key: key) {
            rows = cached
        }
        let iso = ISO8601DateFormatter()
        do {
            let result: [ScheduleReservation] = try await client.from("reservations")
                .select(Self.graph)
                .eq("organization_id", value: organizationId)
                .is("deleted_at", value: nil)
                .in("status", values: ["requested", "confirmed", "checked_in", "checked_out"])
                .lte("start_at", value: iso.string(from: endOfToday))
                .gte("end_at", value: iso.string(from: startOfToday))
                .order("start_at", ascending: true)
                .execute().value
            rows = result
            StaffCache.save(result, key: key)
        } catch {
            // Offline: keep cached rows if we have them.
        }
    }

    var pending: [ScheduleReservation] { rows.filter { $0.status == .requested } }
    var pendingCount: Int { pending.count }
    var inHouseCount: Int { rows.filter { $0.status == .checkedIn }.count }
    var arrivalsCount: Int {
        let cal = Calendar.current
        return rows.filter { cal.isDateInToday($0.startAt) && ($0.status == .requested || $0.status == .confirmed) }.count
    }
    var departuresCount: Int {
        let cal = Calendar.current
        return rows.filter { cal.isDateInToday($0.endAt) }.count
    }
}

struct StaffDashboardView: View {
    @EnvironmentObject private var staff: CurrentStaffService
    @StateObject private var vm = StaffDashboardViewModel()

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
                    greeting
                    statGrid
                    pendingSection
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
            .refreshable { await reload() }
        }
        .task { await reload() }
    }

    private func reload() async {
        guard let org = staff.organizationId else { return }
        await vm.load(organizationId: org)
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text(Date().formatted(.dateTime.weekday(.wide).month().day()))
                .font(SnoutTheme.labelSM).tracking(0.6).foregroundStyle(SnoutTheme.onSurfaceMuted)
            Text(staff.displayName.isEmpty ? "Welcome back" : "Hi, \(firstName)")
                .font(SnoutTheme.titleLG).foregroundStyle(SnoutTheme.onSurface)
        }
    }

    private var firstName: String { staff.displayName.split(separator: " ").first.map(String.init) ?? staff.displayName }

    private var statGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: SnoutTheme.Spacing.md),
                            GridItem(.flexible(), spacing: SnoutTheme.Spacing.md)],
                  spacing: SnoutTheme.Spacing.md) {
            statTile("Pending", vm.pendingCount, "tray.full.fill", SnoutTheme.vanilla)
            statTile("Arrivals", vm.arrivalsCount, "arrow.down.circle.fill", SnoutTheme.frost)
            statTile("In-house", vm.inHouseCount, "house.fill", SnoutTheme.mist)
            statTile("Departures", vm.departuresCount, "arrow.up.circle.fill", SnoutTheme.cotton)
        }
    }

    private func statTile(_ label: String, _ value: Int, _ symbol: String, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            Image(systemName: symbol).font(.system(size: 22)).foregroundStyle(SnoutTheme.onSurface)
            Text("\(value)").font(SnoutTheme.display(34, weight: .bold)).foregroundStyle(SnoutTheme.onSurface)
            Text(label.uppercased()).font(SnoutTheme.labelSM).tracking(0.6).foregroundStyle(SnoutTheme.onSurfaceMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(SnoutTheme.Spacing.lg)
        .background(tint.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    @ViewBuilder
    private var pendingSection: some View {
        if !vm.pending.isEmpty {
            VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
                Text("NEEDS CONFIRMING").font(SnoutTheme.labelSM).tracking(0.8).foregroundStyle(SnoutTheme.onSurfaceMuted)
                ForEach(vm.pending.prefix(5)) { row in
                    HStack(spacing: SnoutTheme.Spacing.md) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.petNames).font(SnoutTheme.body(15, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface)
                            Text([row.service?.name, row.ownerName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceMuted).lineLimit(1)
                        }
                        Spacer()
                        Text(row.startAt.formatted(.dateTime.hour().minute()))
                            .font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceFaint)
                    }
                    .padding(SnoutTheme.Spacing.lg)
                    .background(SnoutTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
                }
                Text("Open the Today tab to confirm and check pets in.")
                    .font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .padding(.top, SnoutTheme.Spacing.xs)
            }
        }
    }
}
