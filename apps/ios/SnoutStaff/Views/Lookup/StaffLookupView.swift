//
//  StaffLookupView.swift
//  Snout Staff
//
//  Search the facility's pets and owners and view their profiles. Read-only
//  in v1 (editing stays on the web). Scoped to the org via is_org_staff RLS.
//

import SwiftUI
import Supabase

@MainActor
final class StaffLookupViewModel: ObservableObject {
    enum Mode: String, CaseIterable { case pets, owners }
    @Published var mode: Mode = .pets
    @Published var query = ""
    @Published var pets: [Pet] = []
    @Published var owners: [Owner] = []
    @Published var isLoading = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared
    private var task: Task<Void, Never>?

    func search(organizationId: String) {
        task?.cancel()
        let q = query.trimmingCharacters(in: .whitespaces)
        task = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 250_000_000) // debounce
            guard let self, !Task.isCancelled else { return }
            await self.run(q: q, organizationId: organizationId)
        }
    }

    private func run(q: String, organizationId: String) async {
        isLoading = true
        defer { isLoading = false }
        // Sanitize for the PostgREST or()/ilike filter.
        let safe = q.filter { $0.isLetter || $0.isNumber || $0 == " " }
        do {
            switch mode {
            case .pets:
                var query = client.from("pets").select()
                    .eq("organization_id", value: organizationId)
                    .is("deleted_at", value: nil)
                if !safe.isEmpty { query = query.ilike("name", pattern: "%\(safe)%") }
                pets = try await query.order("name").limit(40).execute().value
            case .owners:
                var query = client.from("owners").select()
                    .eq("organization_id", value: organizationId)
                    .is("deleted_at", value: nil)
                if !safe.isEmpty {
                    query = query.or("first_name.ilike.*\(safe)*,last_name.ilike.*\(safe)*,email.ilike.*\(safe)*")
                }
                owners = try await query.order("last_name").limit(40).execute().value
            }
            loadError = nil
        } catch {
            let raw = String(describing: error)
            loadError = String(raw.prefix(220))
            #if DEBUG
            print("[StaffLookupViewModel] search failed: \(error)")
            #endif
        }
    }
}

struct StaffLookupView: View {
    @EnvironmentObject private var staff: CurrentStaffService
    @StateObject private var vm = StaffLookupViewModel()

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            VStack(spacing: SnoutTheme.Spacing.md) {
                Picker("", selection: $vm.mode) {
                    Text("Pets").tag(StaffLookupViewModel.Mode.pets)
                    Text("Owners").tag(StaffLookupViewModel.Mode.owners)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, SnoutTheme.Spacing.xl)
                .onChange(of: vm.mode) { _, _ in runSearch() }

                searchField

                if let err = vm.loadError {
                    LoadErrorBanner(message: err)
                        .padding(.horizontal, SnoutTheme.Spacing.xl)
                }

                ScrollView {
                    LazyVStack(spacing: SnoutTheme.Spacing.sm) {
                        if vm.mode == .pets {
                            ForEach(vm.pets) { pet in
                                NavigationLink { StaffPetDetailView(pet: pet) } label: { petRow(pet) }
                                    .buttonStyle(.plain)
                            }
                        } else {
                            ForEach(vm.owners) { owner in
                                NavigationLink { StaffOwnerDetailView(owner: owner) } label: { ownerRow(owner) }
                                    .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.horizontal, SnoutTheme.Spacing.xl)
                    .padding(.bottom, SnoutTheme.Spacing.xxl)
                }
                .scrollContentBackground(.hidden)
            }
            .padding(.top, SnoutTheme.Spacing.sm)
        }
        .task { runSearch() }
    }

    private var searchField: some View {
        HStack(spacing: SnoutTheme.Spacing.sm) {
            Image(systemName: "magnifyingglass").foregroundStyle(SnoutTheme.onSurfaceMuted)
            TextField(vm.mode == .pets ? "Search pets" : "Search owners", text: $vm.query)
                .font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurface)
                .autocorrectionDisabled()
                .onChange(of: vm.query) { _, _ in runSearch() }
        }
        .padding(SnoutTheme.Spacing.md)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous).stroke(SnoutTheme.divider, lineWidth: 1))
        .padding(.horizontal, SnoutTheme.Spacing.xl)
    }

    private func runSearch() {
        guard let org = staff.organizationId else { return }
        vm.search(organizationId: org)
    }

    private func petRow(_ pet: Pet) -> some View {
        rowCard(name: pet.name,
                title: pet.name,
                subtitle: [petSpecies(pet), pet.breed].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
                fallbackSymbol: "pawprint")
    }
    private func ownerRow(_ owner: Owner) -> some View {
        rowCard(name: owner.fullName,
                title: owner.fullName,
                subtitle: [owner.email, owner.phone].compactMap { $0 }.first ?? "",
                fallbackSymbol: "person.fill")
    }
    private func rowCard(name: String, title: String, subtitle: String, fallbackSymbol: String) -> some View {
        HStack(spacing: SnoutTheme.Spacing.md) {
            StaffAvatar(name: name, size: 40, symbolFallback: fallbackSymbol)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(SnoutTheme.body(16, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface)
                if !subtitle.isEmpty { Text(subtitle).font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceMuted) }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(SnoutTheme.onSurfaceFaint)
        }
        .snoutCard()
    }

    private func petSpecies(_ pet: Pet) -> String {
        switch pet.species { case .dog: return "Dog"; case .cat: return "Cat"; case .other: return "Pet" }
    }
}

// MARK: - Pet detail

struct StaffPetDetailView: View {
    let pet: Pet
    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
                    Text(pet.name).font(SnoutTheme.titleLG).foregroundStyle(SnoutTheme.onSurface)
                    infoCard
                    notesCard("Allergies", pet.allergies)
                    notesCard("Feeding", pet.feedingNotes)
                    notesCard("Medication", pet.medicationNotes)
                    notesCard("Behavior", pet.behavioralNotes)
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Pet").navigationBarTitleDisplayMode(.inline)
    }

    private var infoCard: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            detailRow("Species", speciesLabel)
            if let b = pet.breed, !b.isEmpty { detailRow("Breed", b) }
            if let c = pet.color, !c.isEmpty { detailRow("Color", c) }
            if let w = pet.weightKg { detailRow("Weight", "\(w) kg") }
        }
        .padding(SnoutTheme.Spacing.lg).frame(maxWidth: .infinity, alignment: .leading)
        .background(SnoutTheme.surface).clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    @ViewBuilder
    private func notesCard(_ title: String, _ text: String?) -> some View {
        if let text, !text.isEmpty {
            VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
                Text(title.uppercased()).font(SnoutTheme.labelSM).tracking(0.6).foregroundStyle(SnoutTheme.onSurfaceMuted)
                Text(text).font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurface)
            }
            .padding(SnoutTheme.Spacing.lg).frame(maxWidth: .infinity, alignment: .leading)
            .background(SnoutTheme.surface).clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
        }
    }

    private func detailRow(_ l: String, _ v: String) -> some View {
        HStack {
            Text(l).font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurfaceMuted)
            Spacer()
            Text(v).font(SnoutTheme.body(15, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface)
        }
    }
    private var speciesLabel: String {
        switch pet.species { case .dog: return "Dog"; case .cat: return "Cat"; case .other: return "Other" }
    }
}

// MARK: - Owner detail

@MainActor
final class StaffOwnerDetailViewModel: ObservableObject {
    @Published var pets: [Pet] = []
    private let client = SupabaseClientProvider.shared
    func loadPets(ownerId: String) async {
        struct Envelope: Decodable { let pet: Pet }
        let rows: [Envelope] = (try? await client.from("pet_owners")
            .select("pet:pets(*)")
            .eq("owner_id", value: ownerId)
            .execute().value) ?? []
        pets = rows.map(\.pet).filter { $0.deletedAt == nil }
    }
}

struct StaffOwnerDetailView: View {
    let owner: Owner
    @StateObject private var vm = StaffOwnerDetailViewModel()

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
                    Text(owner.fullName).font(SnoutTheme.titleLG).foregroundStyle(SnoutTheme.onSurface)
                    VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
                        if let e = owner.email, !e.isEmpty { row("Email", e) }
                        if let p = owner.phone, !p.isEmpty { row("Phone", p) }
                        if let a = addressLine, !a.isEmpty { row("Address", a) }
                    }
                    .padding(SnoutTheme.Spacing.lg).frame(maxWidth: .infinity, alignment: .leading)
                    .background(SnoutTheme.surface).clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))

                    if !vm.pets.isEmpty {
                        Text("PETS").font(SnoutTheme.labelSM).tracking(0.8).foregroundStyle(SnoutTheme.onSurfaceMuted)
                        ForEach(vm.pets) { pet in
                            NavigationLink { StaffPetDetailView(pet: pet) } label: {
                                HStack {
                                    Text(pet.name).font(SnoutTheme.body(15, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface)
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(SnoutTheme.onSurfaceFaint)
                                }
                                .padding(SnoutTheme.Spacing.lg)
                                .background(SnoutTheme.surface).clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Owner").navigationBarTitleDisplayMode(.inline)
        .task { await vm.loadPets(ownerId: owner.id) }
    }

    private var addressLine: String? {
        [owner.streetAddress, owner.city, owner.stateProvince, owner.postalCode]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }
    private func row(_ l: String, _ v: String) -> some View {
        HStack(alignment: .top) {
            Text(l).font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurfaceMuted)
            Spacer()
            Text(v).font(SnoutTheme.body(15, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface).multilineTextAlignment(.trailing)
        }
    }
}
