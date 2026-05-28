//
//  StaffTrainingView.swift
//  Snout Staff
//
//  Training day view. A trainer sees only the classes they instruct
//  (class_instances.instructor_user_id = their profile); managers/owners/
//  admins/supervisors see all classes today. Tapping a class opens its
//  roster, where attendance is toggled per enrollment.
//

import SwiftUI
import Supabase

struct ClassInstanceRow: Codable, Identifiable, Hashable {
    let id: String
    let startAt: Date
    let endAt: Date
    let status: String?
    let notes: String?
    let seriesId: String?
    let sessionNumber: Int?
    let classType: NamedRef?

    enum CodingKeys: String, CodingKey {
        case id, status, notes
        case startAt = "start_at"
        case endAt = "end_at"
        case seriesId = "series_id"
        case sessionNumber = "session_number"
        case classType = "class_type"
    }
    struct NamedRef: Codable, Hashable { let id: String; let name: String }

    var title: String { classType?.name ?? "Class" }
    var isSeries: Bool { seriesId != nil }
    var timeLabel: String {
        let f = Date.FormatStyle.dateTime.hour().minute()
        return "\(startAt.formatted(f)) – \(endAt.formatted(f))"
    }
    var dayLabel: String { startAt.formatted(.dateTime.weekday(.abbreviated).month().day()) }
}

struct EnrollmentRow: Decodable, Identifiable, Hashable {
    let id: String
    let status: String?
    let attended: Bool?
    let pet: PetRef?
    let owner: OwnerRef?

    struct PetRef: Decodable, Hashable { let id: String; let name: String }
    struct OwnerRef: Decodable, Hashable {
        let id: String; let firstName: String?; let lastName: String?
        enum CodingKeys: String, CodingKey { case id; case firstName = "first_name"; case lastName = "last_name" }
    }
    var petName: String { pet?.name ?? "Pet" }
    var ownerName: String { [owner?.firstName, owner?.lastName].compactMap { $0 }.joined(separator: " ") }
}

@MainActor
final class StaffTrainingViewModel: ObservableObject {
    @Published var classes: [ClassInstanceRow] = []
    @Published var isLoading = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared
    private static let graph = "id, start_at, end_at, status, notes, series_id, session_number, class_type:class_types(id, name)"

    func load(organizationId: String, role: StaffRole, profileId: String?) async {
        isLoading = true
        defer { isLoading = false }
        loadError = nil

        let cacheKey = "training_\(organizationId)_\(role.rawValue)_\(StaffCache.todayKey())"
        if classes.isEmpty, let cached = StaffCache.load([ClassInstanceRow].self, key: cacheKey) {
            classes = cached
        }

        let cal = Calendar.current
        let start = cal.startOfDay(for: Date())
        guard let end = cal.date(byAdding: DateComponents(day: 1, second: -1), to: start) else { return }
        let iso = ISO8601DateFormatter()
        do {
            var query = client.from("class_instances")
                .select(Self.graph)
                .eq("organization_id", value: organizationId)
                .is("deleted_at", value: nil)
                .gte("start_at", value: iso.string(from: start))
                .lte("start_at", value: iso.string(from: end))
            if role == .trainer, let pid = profileId {
                query = query.eq("instructor_user_id", value: pid)
            }
            let result: [ClassInstanceRow] = try await query.order("start_at", ascending: true).execute().value
            classes = result
            StaffCache.save(result, key: cacheKey)
        } catch {
            loadError = error.localizedDescription
        }
    }
}

@MainActor
final class ClassRosterViewModel: ObservableObject {
    @Published var roster: [EnrollmentRow] = []
    @Published var isLoading = false
    @Published var busyId: String?
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared

    func load(classInstanceId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            roster = try await client.from("class_enrollments")
                .select("id, status, attended, pet:pets(id, name), owner:owners(id, first_name, last_name)")
                .eq("class_instance_id", value: classInstanceId)
                .is("cancelled_at", value: nil)
                .order("enrolled_at", ascending: true)
                .execute().value
        } catch {
            loadError = error.localizedDescription
        }
    }

    func setAttended(_ enrollment: EnrollmentRow, _ attended: Bool, classInstanceId: String) async {
        busyId = enrollment.id
        defer { busyId = nil }
        struct Patch: Encodable { let attended: Bool }
        do {
            try await client.from("class_enrollments").update(Patch(attended: attended)).eq("id", value: enrollment.id).execute()
            await load(classInstanceId: classInstanceId)
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct StaffTrainingView: View {
    @EnvironmentObject private var staff: CurrentStaffService
    @StateObject private var vm = StaffTrainingViewModel()

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
                    if vm.isLoading && vm.classes.isEmpty {
                        ProgressView().tint(SnoutTheme.accent).frame(maxWidth: .infinity).padding(.top, SnoutTheme.Spacing.xxl)
                    } else if vm.classes.isEmpty {
                        emptyState
                    } else {
                        ForEach(vm.classes) { c in
                            NavigationLink { classDestination(c) } label: { card(c) }
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
        .onAppear { Task { await reload() } }
    }

    private func reload() async {
        guard let org = staff.organizationId, let role = staff.role else { return }
        await vm.load(organizationId: org, role: role, profileId: staff.profileId)
    }

    // A series-backed class opens its full session list; a standalone class
    // opens its roster directly.
    @ViewBuilder
    private func classDestination(_ c: ClassInstanceRow) -> some View {
        if c.isSeries {
            ClassSeriesView(seriesClass: c)
        } else {
            ClassRosterView(classInstance: c)
        }
    }

    private func card(_ c: ClassInstanceRow) -> some View {
        HStack(spacing: SnoutTheme.Spacing.md) {
            VStack(alignment: .leading, spacing: 4) {
                Text(c.title).font(SnoutTheme.body(16, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface)
                Text(c.timeLabel).font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceMuted)
                if c.isSeries {
                    Text(c.sessionNumber.map { "Series · Session \($0)" } ?? "Series")
                        .font(SnoutTheme.labelSM).tracking(0.4).foregroundStyle(SnoutTheme.accent)
                }
            }
            Spacer()
            SnoutGlyphChevron()
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private var emptyState: some View {
        VStack(spacing: SnoutTheme.Spacing.sm) {
            Image(systemName: "graduationcap").font(.system(size: 28)).foregroundStyle(SnoutTheme.onSurfaceFaint)
            Text("No classes today").font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurfaceMuted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, SnoutTheme.Spacing.xxl)
    }
}

private struct SnoutGlyphChevron: View {
    var body: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(SnoutTheme.onSurfaceFaint)
    }
}

struct ClassRosterView: View {
    let classInstance: ClassInstanceRow
    @StateObject private var vm = ClassRosterViewModel()

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(classInstance.title).font(SnoutTheme.titleMD).foregroundStyle(SnoutTheme.onSurface)
                        Text(classInstance.timeLabel).font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceMuted)
                    }
                    .padding(.horizontal, SnoutTheme.Spacing.xl)

                    Text("ROSTER").font(SnoutTheme.labelSM).tracking(0.8).foregroundStyle(SnoutTheme.onSurfaceMuted)
                        .padding(.horizontal, SnoutTheme.Spacing.xl)

                    if vm.isLoading && vm.roster.isEmpty {
                        ProgressView().tint(SnoutTheme.accent).frame(maxWidth: .infinity).padding(.top, SnoutTheme.Spacing.lg)
                    } else if vm.roster.isEmpty {
                        Text("No one enrolled.").font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurfaceMuted)
                            .padding(.horizontal, SnoutTheme.Spacing.xl)
                    } else {
                        ForEach(vm.roster) { e in rosterRow(e) }
                            .padding(.horizontal, SnoutTheme.Spacing.xl)
                    }
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(.top, SnoutTheme.Spacing.sm)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Class").navigationBarTitleDisplayMode(.inline)
        .task { await vm.load(classInstanceId: classInstance.id) }
    }

    private func rosterRow(_ e: EnrollmentRow) -> some View {
        let attended = e.attended ?? false
        return HStack(spacing: SnoutTheme.Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(e.petName).font(SnoutTheme.body(15, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface)
                if !e.ownerName.isEmpty {
                    Text(e.ownerName).font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
            }
            Spacer()
            Button {
                Task { await vm.setAttended(e, !attended, classInstanceId: classInstance.id) }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: attended ? "checkmark.circle.fill" : "circle")
                    Text(attended ? "Present" : "Mark")
                        .font(SnoutTheme.body(13, weight: .semibold))
                }
                .foregroundStyle(attended ? SnoutTheme.onAccent : SnoutTheme.onSurfaceMuted)
                .padding(.horizontal, SnoutTheme.Spacing.md).padding(.vertical, SnoutTheme.Spacing.sm)
                .background(attended ? SnoutTheme.accent : SnoutTheme.surface)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(attended ? Color.clear : SnoutTheme.divider, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(vm.busyId == e.id)
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }
}

// MARK: - Series: all session dates, each opening its roster/attendance

@MainActor
final class ClassSeriesViewModel: ObservableObject {
    @Published var sessions: [ClassInstanceRow] = []
    @Published var isLoading = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared
    private static let graph = "id, start_at, end_at, status, notes, series_id, session_number, class_type:class_types(id, name)"

    func load(seriesId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            // RLS scopes this to the staff member's org; series_id is org-unique.
            sessions = try await client.from("class_instances")
                .select(Self.graph)
                .eq("series_id", value: seriesId)
                .is("deleted_at", value: nil)
                .order("start_at", ascending: true)
                .execute().value
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct ClassSeriesView: View {
    let seriesClass: ClassInstanceRow
    @StateObject private var vm = ClassSeriesViewModel()

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(seriesClass.title).font(SnoutTheme.titleMD).foregroundStyle(SnoutTheme.onSurface)
                        Text(vm.sessions.isEmpty ? "Class series" : "\(vm.sessions.count) sessions")
                            .font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceMuted)
                    }
                    .padding(.horizontal, SnoutTheme.Spacing.xl)

                    Text("SESSIONS").font(SnoutTheme.labelSM).tracking(0.8).foregroundStyle(SnoutTheme.onSurfaceMuted)
                        .padding(.horizontal, SnoutTheme.Spacing.xl)

                    if vm.isLoading && vm.sessions.isEmpty {
                        ProgressView().tint(SnoutTheme.accent).frame(maxWidth: .infinity).padding(.top, SnoutTheme.Spacing.lg)
                    } else if vm.sessions.isEmpty {
                        Text("No sessions in this series.").font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurfaceMuted)
                            .padding(.horizontal, SnoutTheme.Spacing.xl)
                    } else {
                        ForEach(vm.sessions) { s in
                            NavigationLink { ClassRosterView(classInstance: s) } label: { sessionRow(s) }
                                .buttonStyle(.plain)
                        }
                        .padding(.horizontal, SnoutTheme.Spacing.xl)
                    }
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(.top, SnoutTheme.Spacing.sm)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Series").navigationBarTitleDisplayMode(.inline)
        .task { if let sid = seriesClass.seriesId { await vm.load(seriesId: sid) } }
    }

    private func sessionRow(_ s: ClassInstanceRow) -> some View {
        HStack(spacing: SnoutTheme.Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(s.sessionNumber.map { "Session \($0)" } ?? "Session")
                    .font(SnoutTheme.body(15, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface)
                Text("\(s.dayLabel) · \(s.timeLabel)")
                    .font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
            Spacer()
            if let status = s.status { ClassSessionStatusPill(status: status) }
            SnoutGlyphChevron()
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }
}

private struct ClassSessionStatusPill: View {
    let status: String
    var body: some View {
        Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
            .font(SnoutTheme.labelSM).tracking(0.4).foregroundStyle(SnoutTheme.onSurface)
            .padding(.horizontal, SnoutTheme.Spacing.sm).padding(.vertical, 3)
            .background(tint).clipShape(Capsule())
    }
    private var tint: Color {
        switch status {
        case "completed": return SnoutTheme.cotton
        case "cancelled": return SnoutTheme.divider
        default: return SnoutTheme.frost
        }
    }
}
