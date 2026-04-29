//
//  HomeView.swift
//  Snout
//
//  Pet-parent landing surface. The "everything that matters right now" dashboard.
//  Pulls a small snapshot of the most-recent state for each domain and presents it
//  as warm, glanceable cards. Designed to make the app feel alive on first launch.
//

import SwiftUI

@MainActor
final class HomeViewModel: ObservableObject {
    @Published var pets: [Pet] = []
    @Published var activeReservation: Reservation?     // checked_in right now
    @Published var nextReservation: Reservation?       // upcoming
    @Published var latestReportCard: ReportCard?
    @Published var availableWebcam: Webcam?            // first cam visible to this owner
    @Published var unreadMessageCount: Int = 0
    @Published var orgName: String?
    @Published var isLoading: Bool = false

    private let client = SupabaseClientProvider.shared

    func load(organizationId: String, ownerId: String) async {
        isLoading = true
        defer { isLoading = false }

        async let petsTask: [Pet] = loadPets(ownerId: ownerId)
        async let reservationsTask: [Reservation] = loadReservations(ownerId: ownerId)
        async let cardTask: ReportCard? = loadLatestReportCard(organizationId: organizationId)
        async let webcamTask: Webcam? = loadFirstWebcam(organizationId: organizationId, ownerId: ownerId)
        async let unreadTask: Int = loadUnreadMessageCount(ownerId: ownerId)
        async let orgTask: String? = loadOrgName(organizationId: organizationId)

        let pets = (try? await petsTask) ?? []
        let reservations = (try? await reservationsTask) ?? []
        self.pets = pets

        let now = Date()
        self.activeReservation = reservations.first {
            $0.status == .checkedIn
        }
        self.nextReservation = reservations
            .filter { $0.startAt > now && ($0.status == .confirmed || $0.status == .requested) }
            .min(by: { $0.startAt < $1.startAt })

        self.latestReportCard = (try? await cardTask) ?? nil
        self.availableWebcam = (try? await webcamTask) ?? nil
        self.unreadMessageCount = (try? await unreadTask) ?? 0
        self.orgName = (try? await orgTask) ?? nil
    }

    private func loadPets(ownerId: String) async throws -> [Pet] {
        struct PetOwnerJoin: Decodable { let pet: Pet }
        let rows: [PetOwnerJoin] = try await client
            .from("pet_owners")
            .select("pet:pets(*)")
            .eq("owner_id", value: ownerId)
            .execute()
            .value
        return rows.map(\.pet).filter { $0.deletedAt == nil }
    }

    private func loadReservations(ownerId: String) async throws -> [Reservation] {
        try await client
            .from("reservations")
            .select()
            .eq("primary_owner_id", value: ownerId)
            .is("deleted_at", value: nil)
            .order("start_at", ascending: true)
            .limit(20)
            .execute()
            .value
    }

    private func loadLatestReportCard(organizationId: String) async throws -> ReportCard? {
        let rows: [ReportCard] = try await client
            .from("report_cards")
            .select()
            .eq("organization_id", value: organizationId)
            .eq("published", value: true)
            .order("published_at", ascending: false)
            .limit(1)
            .execute()
            .value
        return rows.first
    }

    private func loadFirstWebcam(organizationId: String, ownerId: String) async throws -> Webcam? {
        // Apply same visibility rule as WebcamListView: org-wide cams always; location-scoped
        // only if user has an active reservation at that location.
        let cams: [Webcam] = try await client
            .from("webcams")
            .select()
            .eq("organization_id", value: organizationId)
            .eq("enabled", value: true)
            .is("deleted_at", value: nil)
            .execute()
            .value

        let activeReservations: [Reservation] = try await client
            .from("reservations")
            .select("id, location_id, status, primary_owner_id, organization_id, start_at, end_at, created_at, updated_at, source, is_recurring")
            .eq("primary_owner_id", value: ownerId)
            .in("status", values: ["confirmed", "checked_in"])
            .is("deleted_at", value: nil)
            .execute()
            .value
        let allowed = Set(activeReservations.compactMap(\.locationId))

        return cams.first { cam in
            cam.locationId == nil || (cam.locationId.map { allowed.contains($0) } ?? false)
        }
    }

    private func loadUnreadMessageCount(ownerId: String) async throws -> Int {
        struct Conv: Decodable { let unread_owner: Int }
        let rows: [Conv] = try await client
            .from("conversations")
            .select("unread_owner")
            .eq("owner_id", value: ownerId)
            .execute()
            .value
        return rows.reduce(0) { $0 + $1.unread_owner }
    }

    private func loadOrgName(organizationId: String) async throws -> String? {
        struct Org: Decodable { let name: String }
        let rows: [Org] = try await client
            .from("organizations")
            .select("name")
            .eq("id", value: organizationId)
            .limit(1)
            .execute()
            .value
        return rows.first?.name
    }
}

struct HomeView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = HomeViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                SnoutTheme.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: SnoutTheme.Spacing.xl) {
                        greeting
                        heroCard
                        if let cam = vm.availableWebcam {
                            cameraCard(cam)
                        }
                        if let card = vm.latestReportCard {
                            reportCardTile(card)
                        }
                        messagesTile
                        Spacer(minLength: SnoutTheme.Spacing.xxl)
                    }
                    .padding(.horizontal, SnoutTheme.Spacing.xl)
                    .padding(.top, SnoutTheme.Spacing.lg)
                }
                .scrollContentBackground(.hidden)
            }
            .navigationBarHidden(true)
            .task { await loadIfReady() }
            .refreshable { await loadIfReady() }
        }
    }

    private func loadIfReady() async {
        if let org = currentOwner.organizationId, let owner = currentOwner.ownerId {
            await vm.load(organizationId: org, ownerId: owner)
        }
    }

    // MARK: - Greeting

    private var greeting: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text(timeOfDayGreeting)
                .font(SnoutTheme.labelLG)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            Text(headlineFirstName)
                .font(SnoutTheme.titleXL)
                .foregroundStyle(SnoutTheme.onSurface)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var timeOfDayGreeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12:  return "Good morning"
        case 12..<17: return "Good afternoon"
        case 17..<22: return "Good evening"
        default:      return "Hello"
        }
    }

    private var headlineFirstName: String {
        if let first = currentOwner.owner?.firstName, !first.isEmpty {
            return first
        }
        return "Pet parent"
    }

    // MARK: - Hero card

    @ViewBuilder
    private var heroCard: some View {
        if let active = vm.activeReservation, let pet = primaryPet {
            heroCheckedIn(pet: pet, reservation: active)
        } else if let next = vm.nextReservation, let pet = primaryPet {
            heroUpcoming(pet: pet, reservation: next)
        } else if let pet = primaryPet {
            heroIdle(pet: pet)
        } else {
            heroEmpty
        }
    }

    private var primaryPet: Pet? { vm.pets.first }

    private func heroCheckedIn(pet: Pet, reservation: Reservation) -> some View {
        HeroCard(
            tint: SnoutTheme.cotton,
            eyebrow: "Right now",
            headline: "\(pet.name) is at \(vm.orgName ?? "your facility")",
            subhead: "Checked in · having a great day",
            symbol: "pawprint.circle.fill",
            badge: "LIVE"
        )
    }

    private func heroUpcoming(pet: Pet, reservation: Reservation) -> some View {
        HeroCard(
            tint: SnoutTheme.vanilla,
            eyebrow: "Next visit",
            headline: "\(pet.name)'s \(serviceLabel(for: reservation))",
            subhead: Format.relativeDateLabel(reservation.startAt),
            symbol: "calendar.circle.fill",
            badge: nil
        )
    }

    private func heroIdle(pet: Pet) -> some View {
        HeroCard(
            tint: SnoutTheme.mist,
            eyebrow: "All quiet",
            headline: "\(pet.name) is at home",
            subhead: "No upcoming visits scheduled",
            symbol: "house.circle.fill",
            badge: nil
        )
    }

    private var heroEmpty: some View {
        HeroCard(
            tint: SnoutTheme.frost,
            eyebrow: "Welcome",
            headline: "Let's get set up",
            subhead: "Your facility will add your pet shortly",
            symbol: "pawprint.circle.fill",
            badge: nil
        )
    }

    private func serviceLabel(for r: Reservation) -> String {
        // Without joining services, infer a friendly label from the duration.
        let hours = r.endAt.timeIntervalSince(r.startAt) / 3600
        switch hours {
        case ..<2:    return "appointment"
        case 2..<7:   return "half day"
        case 7..<13:  return "daycare day"
        default:      return "stay"
        }
    }

    // MARK: - Camera tile

    private func cameraCard(_ cam: Webcam) -> some View {
        NavigationLink {
            WebcamPlayerView(cam: cam)
        } label: {
            HStack(spacing: SnoutTheme.Spacing.lg) {
                ZStack {
                    RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous)
                        .fill(SnoutTheme.frost)
                        .frame(width: 64, height: 64)
                    Image(systemName: "video.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                }
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: SnoutTheme.Spacing.xs) {
                        Circle().fill(SnoutTheme.accent).frame(width: 8, height: 8)
                        Text("LIVE")
                            .font(SnoutTheme.labelSM)
                            .tracking(0.6)
                            .foregroundStyle(SnoutTheme.accent)
                    }
                    Text(cam.name)
                        .font(SnoutTheme.titleSM)
                        .foregroundStyle(SnoutTheme.onSurface)
                    if let d = cam.description {
                        Text(d)
                            .font(SnoutTheme.bodySM)
                            .foregroundStyle(SnoutTheme.onSurfaceMuted)
                            .lineLimit(1)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurfaceFaint)
            }
            .snoutCard()
        }
        .buttonStyle(.plain)
    }

    // MARK: - Latest report card tile

    private func reportCardTile(_ card: ReportCard) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            HStack {
                Text("Latest report card")
                    .font(SnoutTheme.titleMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                Spacer()
                if let pub = card.publishedAt {
                    Text(Format.relativeDateLabel(pub))
                        .font(SnoutTheme.labelMD)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
            }
            if let summary = card.summary, !summary.isEmpty {
                Text("\u{201C}\(summary)\u{201D}")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                    .lineLimit(4)
            }
            HStack(spacing: SnoutTheme.Spacing.sm) {
                if let mood = card.mood {
                    miniPill(emoji: Format.moodEmoji(mood), label: Format.humanize(mood))
                }
                if let energy = card.energyLevel {
                    miniPill(emoji: Format.energyEmoji(energy), label: Format.humanize(energy))
                }
                if let rating = card.overallRating {
                    miniPill(emoji: Format.ratingEmoji(rating), label: Format.humanize(rating))
                }
            }
        }
        .snoutTinted(SnoutTheme.cotton)
    }

    private func miniPill(emoji: String, label: String) -> some View {
        HStack(spacing: 4) {
            Text(emoji)
            Text(label)
                .font(SnoutTheme.labelMD)
                .foregroundStyle(SnoutTheme.onSurface)
        }
        .padding(.horizontal, SnoutTheme.Spacing.md)
        .padding(.vertical, 6)
        .background(SnoutTheme.surface)
        .clipShape(Capsule())
    }

    // MARK: - Messages tile

    @ViewBuilder
    private var messagesTile: some View {
        if vm.unreadMessageCount > 0 {
            HStack(spacing: SnoutTheme.Spacing.lg) {
                ZStack {
                    Circle().fill(SnoutTheme.blueberry).frame(width: 48, height: 48)
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(vm.unreadMessageCount == 1 ? "1 new message" : "\(vm.unreadMessageCount) new messages")
                        .font(SnoutTheme.titleSM)
                        .foregroundStyle(SnoutTheme.onSurface)
                    Text("From your facility")
                        .font(SnoutTheme.bodySM)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurfaceFaint)
            }
            .snoutCard()
        }
    }
}

// MARK: - Hero card

private struct HeroCard: View {
    let tint: Color
    let eyebrow: String
    let headline: String
    let subhead: String
    let symbol: String
    let badge: String?

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            HStack {
                Text(eyebrow.uppercased())
                    .font(SnoutTheme.labelSM)
                    .tracking(0.8)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                Spacer()
                if let badge {
                    HStack(spacing: 4) {
                        Circle().fill(SnoutTheme.accent).frame(width: 6, height: 6)
                        Text(badge)
                            .font(SnoutTheme.labelSM)
                            .tracking(0.6)
                            .foregroundStyle(SnoutTheme.accent)
                    }
                    .padding(.horizontal, SnoutTheme.Spacing.sm)
                    .padding(.vertical, 4)
                    .background(SnoutTheme.surface)
                    .clipShape(Capsule())
                }
            }

            HStack(alignment: .top, spacing: SnoutTheme.Spacing.lg) {
                ZStack {
                    Circle()
                        .fill(SnoutTheme.surface)
                        .frame(width: 64, height: 64)
                    Image(systemName: symbol)
                        .font(.system(size: 30))
                        .foregroundStyle(SnoutTheme.accent)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(headline)
                        .font(SnoutTheme.titleLG)
                        .foregroundStyle(SnoutTheme.onSurface)
                    Text(subhead)
                        .font(SnoutTheme.bodyMD)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                Spacer()
            }
        }
        .padding(SnoutTheme.Spacing.xl)
        .background(tint.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusHero, style: .continuous))
        .shadow(color: SnoutTheme.heroShadowColor,
                radius: SnoutTheme.heroShadowRadius, x: 0, y: SnoutTheme.heroShadowY)
    }
}

#Preview {
    HomeView()
        .environmentObject(CurrentOwnerService())
}
