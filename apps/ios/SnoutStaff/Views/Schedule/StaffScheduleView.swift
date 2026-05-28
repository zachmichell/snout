//
//  StaffScheduleView.swift
//  Snout Staff
//
//  Today's pack: reservations whose date range overlaps today, with quick
//  check-in / check-out. Staff identity (the signed-in user) is recorded on
//  the *_by_user_id columns, mirroring the web check-in/out flow. RLS allows
//  staff (is_org_staff) to read + update reservations in their org.
//

import SwiftUI
import Supabase

// MARK: - Decoded row (reservation + embedded pet/owner/service)

struct ScheduleReservation: Codable, Identifiable, Hashable {
    let id: String
    let status: ReservationStatus
    let startAt: Date
    let endAt: Date
    let notes: String?
    let service: NamedRef?
    let owner: OwnerRef?
    let reservationPets: [PetJoin]

    enum CodingKeys: String, CodingKey {
        case id, status, notes, service, owner
        case startAt = "start_at"
        case endAt = "end_at"
        case reservationPets = "reservation_pets"
    }

    struct NamedRef: Codable, Hashable { let id: String; let name: String }
    struct OwnerRef: Codable, Hashable {
        let id: String
        let firstName: String?
        let lastName: String?
        enum CodingKeys: String, CodingKey { case id; case firstName = "first_name"; case lastName = "last_name" }
    }
    struct PetJoin: Codable, Hashable { let pet: PetRef? }
    struct PetRef: Codable, Hashable { let id: String; let name: String; let species: String? }

    var petNames: String {
        let names = reservationPets.compactMap { $0.pet?.name }
        return names.isEmpty ? "Pet" : names.joined(separator: ", ")
    }
    var ownerName: String {
        guard let o = owner else { return "" }
        return [o.firstName, o.lastName].compactMap { $0 }.joined(separator: " ")
    }
}

// MARK: - View model

@MainActor
final class StaffScheduleViewModel: ObservableObject {
    @Published var rows: [ScheduleReservation] = []
    @Published var isLoading = false
    @Published var loadError: String?
    @Published var busyId: String?

    private let client = SupabaseClientProvider.shared

    private static let selectGraph =
        "id, status, start_at, end_at, notes, service:services(id, name), owner:owners!primary_owner_id(id, first_name, last_name), reservation_pets(pet:pets(id, name, species))"

    private func cacheKey(_ org: String) -> String { "schedule_\(org)_\(StaffCache.todayKey())" }

    func load(organizationId: String) async {
        isLoading = true
        defer { isLoading = false }
        loadError = nil

        // Show cached data instantly (offline-friendly) while we refresh.
        if rows.isEmpty, let cached = StaffCache.load([ScheduleReservation].self, key: cacheKey(organizationId)) {
            rows = cached
        }

        let cal = Calendar.current
        let startOfToday = cal.startOfDay(for: Date())
        guard let endOfToday = cal.date(byAdding: DateComponents(day: 1, second: -1), to: startOfToday) else { return }
        let iso = ISO8601DateFormatter()

        do {
            let result: [ScheduleReservation] = try await client
                .from("reservations")
                .select(Self.selectGraph)
                .eq("organization_id", value: organizationId)
                .is("deleted_at", value: nil)
                .in("status", values: ["requested", "confirmed", "checked_in", "checked_out"])
                // Overlaps today: starts on/before end-of-day AND ends on/after start-of-day.
                .lte("start_at", value: iso.string(from: endOfToday))
                .gte("end_at", value: iso.string(from: startOfToday))
                .order("start_at", ascending: true)
                .execute()
                .value
            rows = result
            StaffCache.save(result, key: cacheKey(organizationId))
        } catch {
            // Offline / failure: keep whatever cached rows we already showed.
            loadError = error.localizedDescription
        }
    }

    /// Advance a reservation's status (confirm / check-in / check-out),
    /// stamping the time + the acting staff user.
    func advance(_ row: ScheduleReservation, to status: ReservationStatus, userId: String?, organizationId: String) async {
        busyId = row.id
        defer { busyId = nil }

        struct StatusPatch: Encodable {
            let status: String
            let confirmed_at: String?
            let confirmed_by_user_id: String?
            let checked_in_at: String?
            let checked_in_by_user_id: String?
            let checked_out_at: String?
            let checked_out_by_user_id: String?
        }
        let now = ISO8601DateFormatter().string(from: Date())
        var patch = StatusPatch(status: status.rawValue, confirmed_at: nil, confirmed_by_user_id: nil,
                                checked_in_at: nil, checked_in_by_user_id: nil,
                                checked_out_at: nil, checked_out_by_user_id: nil)
        switch status {
        case .confirmed:  patch = StatusPatch(status: status.rawValue, confirmed_at: now, confirmed_by_user_id: userId, checked_in_at: nil, checked_in_by_user_id: nil, checked_out_at: nil, checked_out_by_user_id: nil)
        case .checkedIn:  patch = StatusPatch(status: status.rawValue, confirmed_at: nil, confirmed_by_user_id: nil, checked_in_at: now, checked_in_by_user_id: userId, checked_out_at: nil, checked_out_by_user_id: nil)
        case .checkedOut: patch = StatusPatch(status: status.rawValue, confirmed_at: nil, confirmed_by_user_id: nil, checked_in_at: nil, checked_in_by_user_id: nil, checked_out_at: now, checked_out_by_user_id: userId)
        default: break
        }

        do {
            try await client.from("reservations").update(patch).eq("id", value: row.id).execute()
            await load(organizationId: organizationId)
        } catch {
            loadError = error.localizedDescription
        }
    }
}

// MARK: - Lane view

struct StaffScheduleView: View {
    @EnvironmentObject private var staff: CurrentStaffService
    @StateObject private var vm = StaffScheduleViewModel()

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
                    Text(Date().formatted(.dateTime.weekday(.wide).month().day()))
                        .font(SnoutTheme.labelSM)
                        .tracking(0.6)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                        .padding(.horizontal, SnoutTheme.Spacing.xl)

                    if vm.isLoading && vm.rows.isEmpty {
                        ProgressView().tint(SnoutTheme.accent)
                            .frame(maxWidth: .infinity).padding(.top, SnoutTheme.Spacing.xxl)
                    } else if vm.rows.isEmpty {
                        emptyState
                    } else {
                        ForEach(vm.rows) { row in
                            NavigationLink {
                                StaffReservationDetailView(row: row, vm: vm)
                            } label: {
                                reservationCard(row)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.horizontal, SnoutTheme.Spacing.xl)
                    }

                    if let err = vm.loadError {
                        Text(err).font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurface)
                            .padding(SnoutTheme.Spacing.md)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(SnoutTheme.cotton.opacity(0.6))
                            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
                            .padding(.horizontal, SnoutTheme.Spacing.xl)
                    }
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(.top, SnoutTheme.Spacing.sm)
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

    private func reservationCard(_ row: ScheduleReservation) -> some View {
        HStack(spacing: SnoutTheme.Spacing.md) {
            VStack(alignment: .leading, spacing: 4) {
                Text(row.petNames)
                    .font(SnoutTheme.body(16, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                Text([row.service?.name, row.ownerName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .lineLimit(1)
                Text(timeRange(row))
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
            Spacer()
            StatusPill(status: row.status)
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private func timeRange(_ row: ScheduleReservation) -> String {
        let f = Date.FormatStyle.dateTime.hour().minute()
        return "\(row.startAt.formatted(f)) – \(row.endAt.formatted(f))"
    }

    private var emptyState: some View {
        VStack(spacing: SnoutTheme.Spacing.sm) {
            Image(systemName: "pawprint")
                .font(.system(size: 28))
                .foregroundStyle(SnoutTheme.onSurfaceFaint)
            Text("Nothing on the schedule today")
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, SnoutTheme.Spacing.xxl)
    }
}

// MARK: - Status pill

struct StatusPill: View {
    let status: ReservationStatus
    var body: some View {
        Text(label)
            .font(SnoutTheme.labelSM)
            .tracking(0.4)
            .foregroundStyle(SnoutTheme.onSurface)
            .padding(.horizontal, SnoutTheme.Spacing.sm)
            .padding(.vertical, 4)
            .background(tint)
            .clipShape(Capsule())
    }
    private var label: String {
        switch status {
        case .requested: return "Requested"
        case .confirmed: return "Confirmed"
        case .checkedIn: return "Checked in"
        case .checkedOut: return "Checked out"
        case .cancelled: return "Cancelled"
        case .noShow: return "No-show"
        }
    }
    private var tint: Color {
        switch status {
        case .requested: return SnoutTheme.vanilla
        case .confirmed: return SnoutTheme.frost
        case .checkedIn: return SnoutTheme.mist
        case .checkedOut: return SnoutTheme.cotton
        case .cancelled, .noShow: return SnoutTheme.divider
        }
    }
}

// MARK: - Detail + check-in/out

struct StaffReservationDetailView: View {
    let row: ScheduleReservation
    @ObservedObject var vm: StaffScheduleViewModel
    @EnvironmentObject private var staff: CurrentStaffService

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
                    VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
                        Text(current.petNames)
                            .font(SnoutTheme.titleLG)
                            .foregroundStyle(SnoutTheme.onSurface)
                        if !current.ownerName.isEmpty {
                            Text(current.ownerName)
                                .font(SnoutTheme.bodyMD)
                                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                        }
                        StatusPill(status: current.status)
                    }

                    infoCard

                    if let notes = current.notes, !notes.isEmpty {
                        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
                            Text("NOTES").font(SnoutTheme.labelSM).tracking(0.6)
                                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                            Text(notes).font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurface)
                        }
                        .padding(SnoutTheme.Spacing.lg)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(SnoutTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
                    }

                    actionButton
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Reservation")
        .navigationBarTitleDisplayMode(.inline)
    }

    // Always reflect the freshest row from the VM after an action.
    private var current: ScheduleReservation {
        vm.rows.first(where: { $0.id == row.id }) ?? row
    }

    private var infoCard: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            infoRow("Service", current.service?.name ?? "—")
            infoRow("Start", current.startAt.formatted(.dateTime.month().day().hour().minute()))
            infoRow("End", current.endAt.formatted(.dateTime.month().day().hour().minute()))
        }
        .padding(SnoutTheme.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurfaceMuted)
            Spacer()
            Text(value).font(SnoutTheme.body(15, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface)
        }
    }

    @ViewBuilder
    private var actionButton: some View {
        if let next = nextStatus {
            Button {
                Task { await vm.advance(current, to: next.status, userId: staff.profileId, organizationId: staff.organizationId ?? "") }
            } label: {
                HStack(spacing: SnoutTheme.Spacing.sm) {
                    if vm.busyId == current.id { ProgressView().tint(SnoutTheme.onAccent) }
                    Text(next.label)
                        .font(SnoutTheme.body(16, weight: .semibold))
                }
                .foregroundStyle(SnoutTheme.onAccent)
                .frame(maxWidth: .infinity)
                .padding(.vertical, SnoutTheme.Spacing.md)
                .background(SnoutTheme.accent)
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(vm.busyId == current.id)
        }
    }

    private var nextStatus: (status: ReservationStatus, label: String)? {
        switch current.status {
        case .requested: return (.confirmed, "Confirm")
        case .confirmed: return (.checkedIn, "Check in")
        case .checkedIn: return (.checkedOut, "Check out")
        default: return nil
        }
    }
}
