//
//  StaffGroomingView.swift
//  Snout Staff
//
//  Grooming day view. A groomer sees only their own appointments (resolved
//  via groomers.staff_member_id = their profile); managers/owners/admins/
//  supervisors see the whole day. Headline action: advance the appointment
//  Confirm → Check in → Complete (stamping check_in_time / completed_time).
//

import SwiftUI
import Supabase

struct GroomingAppt: Codable, Identifiable, Hashable {
    let id: String
    let appointmentDate: String
    let startTime: String?
    let estimatedDurationMinutes: Int?
    let status: String
    let notes: String?
    let pet: PetRef?
    let owner: OwnerRef?
    let groomer: GroomerRef?

    enum CodingKeys: String, CodingKey {
        case id, status, notes, pet, owner, groomer
        case appointmentDate = "appointment_date"
        case startTime = "start_time"
        case estimatedDurationMinutes = "estimated_duration_minutes"
    }
    struct PetRef: Codable, Hashable { let id: String; let name: String }
    struct OwnerRef: Codable, Hashable {
        let id: String; let firstName: String?; let lastName: String?
        enum CodingKeys: String, CodingKey { case id; case firstName = "first_name"; case lastName = "last_name" }
    }
    struct GroomerRef: Codable, Hashable { let id: String; let displayName: String? }

    var petName: String { pet?.name ?? "Pet" }
    var ownerName: String { [owner?.firstName, owner?.lastName].compactMap { $0 }.joined(separator: " ") }
    /// "9:00 AM" from a "HH:mm:ss" time string.
    var timeLabel: String {
        guard let t = startTime else { return "" }
        let parts = t.split(separator: ":")
        guard parts.count >= 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return t }
        var c = DateComponents(); c.hour = h; c.minute = m
        guard let date = Calendar.current.date(from: c) else { return t }
        return date.formatted(.dateTime.hour().minute())
    }
}

@MainActor
final class StaffGroomingViewModel: ObservableObject {
    @Published var appts: [GroomingAppt] = []
    @Published var isLoading = false
    @Published var loadError: String?
    @Published var busyId: String?

    private let client = SupabaseClientProvider.shared
    private static let graph = "id, appointment_date, start_time, estimated_duration_minutes, status, notes, pet:pets(id, name), owner:owners(id, first_name, last_name), groomer:groomers(id, display_name)"

    func load(organizationId: String, role: StaffRole, profileId: String?) async {
        isLoading = true
        defer { isLoading = false }
        loadError = nil

        let cacheKey = "grooming_\(organizationId)_\(role.rawValue)_\(StaffCache.todayKey())"
        if appts.isEmpty, let cached = StaffCache.load([GroomingAppt].self, key: cacheKey) {
            appts = cached
        }

        let today = Self.ymd(Date())
        do {
            var query = client.from("grooming_appointments")
                .select(Self.graph)
                .eq("organization_id", value: organizationId)
                .eq("appointment_date", value: today)

            // A groomer only sees their own column.
            if role == .groomer, let pid = profileId {
                let mine: [GroomerIdRow] = try await client
                    .from("groomers").select("id").eq("staff_member_id", value: pid).limit(1).execute().value
                guard let groomerId = mine.first?.id else { appts = []; return }
                query = query.eq("groomer_id", value: groomerId)
            }

            let result: [GroomingAppt] = try await query.order("start_time", ascending: true).execute().value
            appts = result
            StaffCache.save(result, key: cacheKey)
        } catch {
            loadError = error.localizedDescription
        }
    }

    func advance(_ appt: GroomingAppt, to status: String, organizationId: String, role: StaffRole, profileId: String?) async {
        busyId = appt.id
        defer { busyId = nil }
        struct Patch: Encodable {
            let status: String
            let check_in_time: String?
            let completed_time: String?
        }
        let now = ISO8601DateFormatter().string(from: Date())
        let patch: Patch
        switch status {
        case "checked_in": patch = Patch(status: status, check_in_time: now, completed_time: nil)
        case "completed":  patch = Patch(status: status, check_in_time: nil, completed_time: now)
        default:           patch = Patch(status: status, check_in_time: nil, completed_time: nil)
        }
        do {
            try await client.from("grooming_appointments").update(patch).eq("id", value: appt.id).execute()
            await load(organizationId: organizationId, role: role, profileId: profileId)
        } catch {
            loadError = error.localizedDescription
        }
    }

    private struct GroomerIdRow: Decodable { let id: String }
    private static func ymd(_ d: Date) -> String {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
}

struct StaffGroomingView: View {
    @EnvironmentObject private var staff: CurrentStaffService
    @StateObject private var vm = StaffGroomingViewModel()

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
                    if vm.isLoading && vm.appts.isEmpty {
                        ProgressView().tint(SnoutTheme.accent).frame(maxWidth: .infinity).padding(.top, SnoutTheme.Spacing.xxl)
                    } else if vm.appts.isEmpty {
                        emptyState
                    } else {
                        ForEach(vm.appts) { appt in
                            NavigationLink { StaffGroomingDetailView(appt: appt, vm: vm) } label: { card(appt) }
                                .buttonStyle(.plain)
                        }
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
        guard let org = staff.organizationId, let role = staff.role else { return }
        await vm.load(organizationId: org, role: role, profileId: staff.profileId)
    }

    private func card(_ appt: GroomingAppt) -> some View {
        HStack(spacing: SnoutTheme.Spacing.md) {
            VStack(alignment: .leading, spacing: 4) {
                Text(appt.petName).font(SnoutTheme.body(16, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface)
                Text([appt.ownerName, appt.timeLabel].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
            Spacer()
            GroomingStatusPill(status: appt.status)
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private var emptyState: some View {
        VStack(spacing: SnoutTheme.Spacing.sm) {
            Image(systemName: "scissors").font(.system(size: 28)).foregroundStyle(SnoutTheme.onSurfaceFaint)
            Text("No grooming appointments today").font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurfaceMuted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, SnoutTheme.Spacing.xxl)
    }
}

struct GroomingStatusPill: View {
    let status: String
    var body: some View {
        Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
            .font(SnoutTheme.labelSM).tracking(0.4).foregroundStyle(SnoutTheme.onSurface)
            .padding(.horizontal, SnoutTheme.Spacing.sm).padding(.vertical, 4)
            .background(tint).clipShape(Capsule())
    }
    private var tint: Color {
        switch status {
        case "requested": return SnoutTheme.vanilla
        case "confirmed": return SnoutTheme.frost
        case "checked_in", "in_progress": return SnoutTheme.mist
        case "completed": return SnoutTheme.cotton
        default: return SnoutTheme.divider
        }
    }
}

struct StaffGroomingDetailView: View {
    let appt: GroomingAppt
    @ObservedObject var vm: StaffGroomingViewModel
    @EnvironmentObject private var staff: CurrentStaffService

    private var current: GroomingAppt { vm.appts.first(where: { $0.id == appt.id }) ?? appt }

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
                    VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
                        Text(current.petName).font(SnoutTheme.titleLG).foregroundStyle(SnoutTheme.onSurface)
                        if !current.ownerName.isEmpty {
                            Text(current.ownerName).font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurfaceMuted)
                        }
                        GroomingStatusPill(status: current.status)
                    }
                    VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
                        row("Time", current.timeLabel.isEmpty ? "—" : current.timeLabel)
                        row("Duration", current.estimatedDurationMinutes.map { "\($0) min" } ?? "—")
                        if let g = current.groomer?.displayName { row("Groomer", g) }
                    }
                    .padding(SnoutTheme.Spacing.lg).frame(maxWidth: .infinity, alignment: .leading)
                    .background(SnoutTheme.surface).clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))

                    if let notes = current.notes, !notes.isEmpty {
                        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
                            Text("NOTES").font(SnoutTheme.labelSM).tracking(0.6).foregroundStyle(SnoutTheme.onSurfaceMuted)
                            Text(notes).font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurface)
                        }
                        .padding(SnoutTheme.Spacing.lg).frame(maxWidth: .infinity, alignment: .leading)
                        .background(SnoutTheme.surface).clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
                    }

                    if let next = nextStep {
                        Button {
                            Task { await vm.advance(current, to: next.status, organizationId: staff.organizationId ?? "", role: staff.role ?? .staff, profileId: staff.profileId) }
                        } label: {
                            HStack(spacing: SnoutTheme.Spacing.sm) {
                                if vm.busyId == current.id { ProgressView().tint(SnoutTheme.onAccent) }
                                Text(next.label).font(SnoutTheme.body(16, weight: .semibold))
                            }
                            .foregroundStyle(SnoutTheme.onAccent).frame(maxWidth: .infinity)
                            .padding(.vertical, SnoutTheme.Spacing.md).background(SnoutTheme.accent).clipShape(Capsule())
                        }
                        .buttonStyle(.plain).disabled(vm.busyId == current.id)
                    }
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Appointment").navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ l: String, _ v: String) -> some View {
        HStack {
            Text(l).font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurfaceMuted)
            Spacer()
            Text(v).font(SnoutTheme.body(15, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface)
        }
    }

    private var nextStep: (status: String, label: String)? {
        switch current.status {
        case "requested": return ("confirmed", "Confirm")
        case "confirmed": return ("checked_in", "Check in")
        case "checked_in", "in_progress": return ("completed", "Mark complete")
        default: return nil
        }
    }
}
