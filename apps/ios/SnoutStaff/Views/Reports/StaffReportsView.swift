//
//  StaffReportsView.swift
//  Snout Staff
//
//  The "Reports" lane (home for staff). Lists today's pets (flattened from
//  today's reservations) and lets staff log care for a pet on its visit:
//  feeding, medication, potty, activity, nap, water, notes. Report-card
//  authoring is added to the pet/visit screen in a follow-up PR.
//

import SwiftUI
import Supabase

// MARK: - Care log types

enum CareLogType: String, CaseIterable, Identifiable {
    case feeding, medication, potty, activity, nap, water, note
    var id: String { rawValue }
    var label: String {
        switch self {
        case .feeding: return "Feeding"
        case .medication: return "Medication"
        case .potty: return "Potty"
        case .activity: return "Activity"
        case .nap: return "Nap"
        case .water: return "Water"
        case .note: return "Note"
        }
    }
    var symbol: String {
        switch self {
        case .feeding: return "fork.knife"
        case .medication: return "pills.fill"
        case .potty: return "toilet.fill"
        case .activity: return "figure.run"
        case .nap: return "moon.zzz.fill"
        case .water: return "drop.fill"
        case .note: return "note.text"
        }
    }
}

struct CareLog: Decodable, Identifiable, Hashable {
    let id: String
    let logType: String
    let notes: String?
    let loggedAt: Date
    enum CodingKeys: String, CodingKey {
        case id, notes
        case logType = "log_type"
        case loggedAt = "logged_at"
    }
    var type: CareLogType? { CareLogType(rawValue: logType) }
}

// MARK: - Today's pet visits

struct PetVisit: Codable, Identifiable, Hashable {
    let reservationId: String
    let petId: String
    let petName: String
    let ownerName: String
    let serviceName: String?
    var id: String { reservationId + "/" + petId }
}

@MainActor
final class StaffReportsViewModel: ObservableObject {
    @Published var visits: [PetVisit] = []
    @Published var isLoading = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared
    private static let graph =
        "id, status, start_at, end_at, notes, service:services(id, name), owner:owners!primary_owner_id(id, first_name, last_name), reservation_pets(pet:pets(id, name, species))"

    func load(organizationId: String) async {
        isLoading = true
        defer { isLoading = false }
        loadError = nil
        let key = "reports_\(organizationId)_\(StaffCache.todayKey())"
        if visits.isEmpty, let cached = StaffCache.load([PetVisit].self, key: key) {
            visits = cached
        }
        let cal = Calendar.current
        let start = cal.startOfDay(for: Date())
        guard let end = cal.date(byAdding: DateComponents(day: 1, second: -1), to: start) else { return }
        let iso = ISO8601DateFormatter()
        do {
            let rows: [ScheduleReservation] = try await client
                .from("reservations")
                .select(Self.graph)
                .eq("organization_id", value: organizationId)
                .is("deleted_at", value: nil)
                .in("status", values: ["confirmed", "checked_in", "checked_out"])
                .lte("start_at", value: iso.string(from: end))
                .gte("end_at", value: iso.string(from: start))
                .order("start_at", ascending: true)
                .execute()
                .value
            let flattened = rows.flatMap { r in
                r.reservationPets.compactMap { join -> PetVisit? in
                    guard let pet = join.pet else { return nil }
                    return PetVisit(reservationId: r.id, petId: pet.id, petName: pet.name,
                                    ownerName: r.ownerName, serviceName: r.service?.name)
                }
            }
            visits = flattened
            StaffCache.save(flattened, key: key)
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct StaffReportsView: View {
    @EnvironmentObject private var staff: CurrentStaffService
    @StateObject private var vm = StaffReportsViewModel()

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
                    if vm.isLoading && vm.visits.isEmpty {
                        ProgressView().tint(SnoutTheme.accent).frame(maxWidth: .infinity).padding(.top, SnoutTheme.Spacing.xxl)
                    } else if vm.visits.isEmpty {
                        emptyState
                    } else {
                        ForEach(vm.visits) { visit in
                            NavigationLink { StaffPetVisitView(visit: visit) } label: { card(visit) }
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
        guard let org = staff.organizationId else { return }
        await vm.load(organizationId: org)
    }

    private func card(_ visit: PetVisit) -> some View {
        HStack(spacing: SnoutTheme.Spacing.md) {
            VStack(alignment: .leading, spacing: 4) {
                Text(visit.petName).font(SnoutTheme.body(16, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface)
                Text([visit.serviceName, visit.ownerName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceMuted).lineLimit(1)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(SnoutTheme.onSurfaceFaint)
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private var emptyState: some View {
        VStack(spacing: SnoutTheme.Spacing.sm) {
            Image(systemName: "doc.text").font(.system(size: 28)).foregroundStyle(SnoutTheme.onSurfaceFaint)
            Text("No pets in today").font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurfaceMuted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, SnoutTheme.Spacing.xxl)
    }
}

// MARK: - Pet visit (care log)

@MainActor
final class PetVisitViewModel: ObservableObject {
    @Published var logs: [CareLog] = []
    @Published var isLoading = false
    @Published var isSaving = false
    @Published var error: String?

    private let client = SupabaseClientProvider.shared

    func loadLogs(reservationId: String, petId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            logs = try await client.from("pet_care_logs")
                .select("id, log_type, notes, logged_at")
                .eq("reservation_id", value: reservationId)
                .eq("pet_id", value: petId)
                .order("logged_at", ascending: false)
                .execute().value
        } catch {
            self.error = error.localizedDescription
        }
    }

    func addLog(type: CareLogType, notes: String, visit: PetVisit, organizationId: String, loggedBy: String?) async {
        isSaving = true
        defer { isSaving = false }
        struct Insert: Encodable {
            let organization_id: String
            let pet_id: String
            let reservation_id: String
            let log_type: String
            let notes: String?
            let logged_at: String
            let logged_by: String?
        }
        let payload = Insert(organization_id: organizationId, pet_id: visit.petId,
                             reservation_id: visit.reservationId, log_type: type.rawValue,
                             notes: notes.isEmpty ? nil : notes,
                             logged_at: ISO8601DateFormatter().string(from: Date()), logged_by: loggedBy)
        do {
            try await client.from("pet_care_logs").insert(payload).execute()
            await loadLogs(reservationId: visit.reservationId, petId: visit.petId)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct StaffPetVisitView: View {
    let visit: PetVisit
    @EnvironmentObject private var staff: CurrentStaffService
    @StateObject private var vm = PetVisitViewModel()
    @State private var showLogSheet = false

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
                    VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
                        Text(visit.petName).font(SnoutTheme.titleLG).foregroundStyle(SnoutTheme.onSurface)
                        if !visit.ownerName.isEmpty {
                            Text(visit.ownerName).font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurfaceMuted)
                        }
                    }

                    NavigationLink {
                        StaffReportCardEditor(visit: visit)
                    } label: {
                        HStack(spacing: SnoutTheme.Spacing.sm) {
                            Image(systemName: "doc.text.fill").font(.system(size: 16, weight: .semibold))
                            Text("Report card").font(SnoutTheme.body(15, weight: .semibold))
                        }
                        .foregroundStyle(SnoutTheme.onAccent).frame(maxWidth: .infinity)
                        .padding(.vertical, SnoutTheme.Spacing.md).background(SnoutTheme.accent).clipShape(Capsule())
                    }
                    .buttonStyle(.plain)

                    Button {
                        showLogSheet = true
                    } label: {
                        HStack(spacing: SnoutTheme.Spacing.sm) {
                            Image(systemName: "plus.circle.fill").font(.system(size: 16, weight: .semibold))
                            Text("Add care log").font(SnoutTheme.body(15, weight: .semibold))
                        }
                        .foregroundStyle(SnoutTheme.onSurface).frame(maxWidth: .infinity)
                        .padding(.vertical, SnoutTheme.Spacing.md).background(SnoutTheme.surface).clipShape(Capsule())
                        .overlay(Capsule().stroke(SnoutTheme.divider, lineWidth: 1))
                    }
                    .buttonStyle(.plain)

                    Text("TODAY'S LOG").font(SnoutTheme.labelSM).tracking(0.8).foregroundStyle(SnoutTheme.onSurfaceMuted)

                    if vm.logs.isEmpty {
                        Text("No care logged yet.").font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurfaceMuted)
                    } else {
                        VStack(spacing: SnoutTheme.Spacing.sm) {
                            ForEach(vm.logs) { logRow($0) }
                        }
                    }
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Care").navigationBarTitleDisplayMode(.inline)
        .task { await vm.loadLogs(reservationId: visit.reservationId, petId: visit.petId) }
        .sheet(isPresented: $showLogSheet) {
            CareLogSheet { type, notes in
                Task {
                    await vm.addLog(type: type, notes: notes, visit: visit,
                                    organizationId: staff.organizationId ?? "", loggedBy: staff.profileId)
                }
            }
        }
    }

    private func logRow(_ log: CareLog) -> some View {
        HStack(spacing: SnoutTheme.Spacing.md) {
            Image(systemName: log.type?.symbol ?? "note.text")
                .font(.system(size: 16)).foregroundStyle(SnoutTheme.onSurfaceMuted).frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(log.type?.label ?? log.logType.capitalized)
                    .font(SnoutTheme.body(15, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface)
                if let n = log.notes, !n.isEmpty {
                    Text(n).font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
            }
            Spacer()
            Text(log.loggedAt.formatted(.dateTime.hour().minute()))
                .font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceFaint)
        }
        .padding(SnoutTheme.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }
}

// MARK: - Care log entry sheet

struct CareLogSheet: View {
    let onSave: (CareLogType, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var type: CareLogType = .feeding
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            ZStack {
                SnoutTheme.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
                        Text("TYPE").font(SnoutTheme.labelSM).tracking(0.8).foregroundStyle(SnoutTheme.onSurfaceMuted)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: SnoutTheme.Spacing.sm)], spacing: SnoutTheme.Spacing.sm) {
                            ForEach(CareLogType.allCases) { t in
                                Button { type = t } label: {
                                    VStack(spacing: 6) {
                                        Image(systemName: t.symbol).font(.system(size: 18))
                                        Text(t.label).font(SnoutTheme.body(12, weight: .semibold))
                                    }
                                    .foregroundStyle(type == t ? SnoutTheme.onAccent : SnoutTheme.onSurface)
                                    .frame(maxWidth: .infinity).padding(.vertical, SnoutTheme.Spacing.md)
                                    .background(type == t ? SnoutTheme.accent : SnoutTheme.surface)
                                    .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous)
                                        .stroke(type == t ? Color.clear : SnoutTheme.divider, lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        StaffMultilineField(label: "Notes", text: $notes, placeholder: "Optional details")
                        Spacer(minLength: SnoutTheme.Spacing.lg)
                    }
                    .padding(SnoutTheme.Spacing.xl)
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Add care log").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { onSave(type, notes.trimmingCharacters(in: .whitespaces)); dismiss() }
                        .foregroundStyle(SnoutTheme.accent)
                }
            }
        }
    }
}
