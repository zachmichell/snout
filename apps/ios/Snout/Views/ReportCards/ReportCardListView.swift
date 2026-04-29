//
//  ReportCardListView.swift
//  Snout
//
//  Warm card-per-report-card list. Each card carries the date, summary preview, and
//  a thumbnail strip if photos exist.
//

import SwiftUI

@MainActor
final class ReportCardListViewModel: ObservableObject {
    @Published var cards: [ReportCard] = []
    @Published var petsById: [String: Pet] = [:]
    @Published var isLoading: Bool = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared

    func load(organizationId: String, ownerId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            // 1) pet ids belonging to this owner
            struct PetOwnerJoin: Decodable { let pet: Pet }
            let petJoins: [PetOwnerJoin] = try await client
                .from("pet_owners")
                .select("pet:pets(*)")
                .eq("owner_id", value: ownerId)
                .execute()
                .value
            let pets = petJoins.map(\.pet).filter { $0.deletedAt == nil }
            petsById = Dictionary(uniqueKeysWithValues: pets.map { ($0.id, $0) })

            // 2) report cards for those pets
            let rows: [ReportCard] = try await client
                .from("report_cards")
                .select()
                .eq("organization_id", value: organizationId)
                .eq("published", value: true)
                .order("published_at", ascending: false)
                .limit(100)
                .execute()
                .value
            cards = rows
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    func petName(for card: ReportCard) -> String {
        petsById[card.petId]?.name ?? "Your pet"
    }
}

struct ReportCardListView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = ReportCardListViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                SnoutTheme.background.ignoresSafeArea()
                content
            }
            .navigationTitle("Report Cards")
            .navigationBarTitleDisplayMode(.large)
            .task { await loadIfReady() }
            .refreshable { await loadIfReady() }
        }
    }

    private func loadIfReady() async {
        if let org = currentOwner.organizationId, let owner = currentOwner.ownerId {
            await vm.load(organizationId: org, ownerId: owner)
        }
    }

    @ViewBuilder
    private var content: some View {
        if let err = currentOwner.loadError {
            errorState(err)
        } else if vm.isLoading && vm.cards.isEmpty {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let err = vm.loadError {
            errorState(err)
        } else if vm.cards.isEmpty {
            emptyState
        } else {
            list
        }
    }

    private var list: some View {
        ScrollView {
            VStack(spacing: SnoutTheme.Spacing.lg) {
                ForEach(vm.cards) { card in
                    NavigationLink {
                        ReportCardDetailView(card: card, petName: vm.petName(for: card))
                    } label: {
                        ReportCardRowCard(card: card, petName: vm.petName(for: card))
                    }
                    .buttonStyle(.plain)
                }
                Spacer(minLength: SnoutTheme.Spacing.xxl)
            }
            .padding(.horizontal, SnoutTheme.Spacing.xl)
            .padding(.top, SnoutTheme.Spacing.md)
        }
        .scrollContentBackground(.hidden)
    }

    private var emptyState: some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            Image(systemName: "photo.stack")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(SnoutTheme.onSurfaceFaint)
            Text("No report cards yet")
                .font(SnoutTheme.titleMD)
                .foregroundStyle(SnoutTheme.onSurface)
            Text("After your pet's next visit, your facility's report card will land here.")
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
            Text("Couldn't load report cards")
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

struct ReportCardRowCard: View {
    let card: ReportCard
    let petName: String

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(petName)
                        .font(SnoutTheme.titleMD)
                        .foregroundStyle(SnoutTheme.onSurface)
                    Text(dateLabel)
                        .font(SnoutTheme.labelMD)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                Spacer()
                if let rating = card.overallRating {
                    Text(Format.ratingEmoji(rating))
                        .font(.system(size: 22))
                }
            }
            if let summary = card.summary, !summary.isEmpty {
                Text(summary)
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                    .lineLimit(3)
            }
            HStack(spacing: SnoutTheme.Spacing.xs) {
                if let mood = card.mood {
                    inlinePill(emoji: Format.moodEmoji(mood), label: Format.humanize(mood))
                }
                if let energy = card.energyLevel {
                    inlinePill(emoji: Format.energyEmoji(energy), label: Format.humanize(energy))
                }
                Spacer()
                if !card.photoURLs.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "photo")
                            .font(.system(size: 12, weight: .medium))
                        Text("\(card.photoURLs.count)")
                            .font(SnoutTheme.labelSM)
                    }
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
            }
        }
        .snoutCard()
    }

    private func inlinePill(emoji: String, label: String) -> some View {
        HStack(spacing: 3) {
            Text(emoji)
                .font(.system(size: 12))
            Text(label)
                .font(SnoutTheme.labelSM)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(SnoutTheme.cotton.opacity(0.4))
        .clipShape(Capsule())
    }

    private var dateLabel: String {
        guard let pub = card.publishedAt else { return "Report card" }
        let f = DateFormatter()
        f.dateFormat = "EEEE, MMMM d"
        return f.string(from: pub)
    }
}
