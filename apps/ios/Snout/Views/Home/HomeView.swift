//
//  HomeView.swift
//  Snout
//
//  Pet-parent landing surface. Three glanceable sections, in priority order:
//    1. Greeting (time-of-day + first name)
//    2. Compact "next visit" hero card (or current-visit if checked in)
//    3. Credits summary — full days, half days, nights at a glance
//
//  Cameras live in their own tab. Report cards live in Settings → Library.
//  Unread message count drives a badge on the Messages tab (see MainTabView).
//

import SwiftUI

@MainActor
final class HomeViewModel: ObservableObject {
    @Published var pets: [Pet] = []
    @Published var activeReservation: Reservation?     // checked_in right now
    @Published var nextReservation: Reservation?       // upcoming
    @Published var orgName: String?
    @Published var locations: [Location] = []
    @Published var isLoading: Bool = false

    private let client = SupabaseClientProvider.shared

    func load(organizationId: String, ownerId: String) async {
        isLoading = true
        defer { isLoading = false }

        async let petsTask: [Pet] = loadPets(ownerId: ownerId)
        async let reservationsTask: [Reservation] = loadReservations(ownerId: ownerId)
        async let orgTask: String? = loadOrgName(organizationId: organizationId)
        async let locationsTask: [Location] = loadLocations(organizationId: organizationId)

        let pets = (try? await petsTask) ?? []
        let reservations = (try? await reservationsTask) ?? []
        self.pets = pets

        let now = Date()
        self.activeReservation = reservations.first { $0.status == .checkedIn }
        self.nextReservation = reservations
            .filter { $0.startAt > now && ($0.status == .confirmed || $0.status == .requested) }
            .min(by: { $0.startAt < $1.startAt })

        self.orgName = (try? await orgTask) ?? nil
        self.locations = (try? await locationsTask) ?? []
    }

    /// The location to surface in the header. Priority:
    /// 1. The active reservation's location (we're checked in there right now).
    /// 2. The next upcoming reservation's location.
    /// 3. The first active location of the org as a fallback.
    var displayLocation: Location? {
        let resLocId = activeReservation?.locationId ?? nextReservation?.locationId
        if let id = resLocId, let match = locations.first(where: { $0.id == id }) {
            return match
        }
        return locations.first(where: { $0.active })
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

    private func loadLocations(organizationId: String) async throws -> [Location] {
        try await client
            .from("locations")
            .select()
            .eq("organization_id", value: organizationId)
            .is("deleted_at", value: nil)
            .order("created_at", ascending: true)
            .execute()
            .value
    }
}

struct HomeView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @EnvironmentObject private var unread: UnreadMessagesService
    @StateObject private var vm = HomeViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                SnoutTheme.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: SnoutTheme.Spacing.xl) {
                        facilityHeader
                        greeting
                        heroCard
                        creditsCard
                        Spacer(minLength: SnoutTheme.Spacing.xxl)
                    }
                    .padding(.horizontal, SnoutTheme.Spacing.xl)
                    .padding(.top, SnoutTheme.Spacing.lg)
                }
                .scrollContentBackground(.hidden)
            }
            .navigationBarHidden(true)
            .task { await loadIfReady() }
            .refreshable {
                await currentOwner.refreshOwner()
                await unread.refresh(ownerId: currentOwner.ownerId)
                await loadIfReady()
            }
        }
    }

    private func loadIfReady() async {
        if let org = currentOwner.organizationId, let owner = currentOwner.ownerId {
            await vm.load(organizationId: org, ownerId: owner)
        }
    }

    // MARK: - Facility header

    /// Business-identity strip above the greeting: monogram tile + org name +
    /// address subtitle. Designed so we can later swap the monogram for a real
    /// logo image (organizations table doesn't have a logo column today).
    @ViewBuilder
    private var facilityHeader: some View {
        if let org = vm.orgName {
            HStack(spacing: SnoutTheme.Spacing.md) {
                ZStack {
                    Circle()
                        .fill(SnoutTheme.cotton.opacity(0.7))
                        .frame(width: 38, height: 38)
                    Text(monogram(for: org))
                        .font(SnoutTheme.body(13, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(org)
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                        .lineLimit(1)
                    if let addr = facilityAddressLine {
                        Text(addr)
                            .font(SnoutTheme.bodySM)
                            .foregroundStyle(SnoutTheme.onSurfaceMuted)
                            .lineLimit(1)
                    }
                }
                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Address subtitle — street only (no city/state) so it reads like
    /// "123 Dogwood Drive". For multi-location orgs we prefix the location name
    /// so the parent knows which physical site they're looking at.
    private var facilityAddressLine: String? {
        guard let loc = vm.displayLocation else { return nil }
        let street = loc.streetLine
        if vm.locations.count > 1 {
            if let street { return "\(loc.name) · \(street)" }
            return loc.name
        }
        return street
    }

    private func monogram(for name: String) -> String {
        let words = name.split(separator: " ").prefix(2)
        let initials = words.compactMap { $0.first.map(String.init) }
        let mono = initials.joined()
        return mono.isEmpty ? "•" : mono.uppercased()
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

    // MARK: - Hero card (compact)

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
        let hours = r.endAt.timeIntervalSince(r.startAt) / 3600
        switch hours {
        case ..<2:    return "appointment"
        case 2..<7:   return "half day"
        case 7..<13:  return "daycare day"
        default:      return "stay"
        }
    }

    // MARK: - Credits card

    private var creditsCard: some View {
        let owner = currentOwner.owner
        let full = owner?.daycareFullDayCredits ?? 0
        let half = owner?.daycareHalfDayCredits ?? 0
        let nights = owner?.boardingNightCredits ?? 0
        let hasAny = full + half + nights > 0

        return VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
            HStack {
                Text("Your credits")
                    .font(SnoutTheme.titleMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                Spacer()
            }

            if hasAny {
                HStack(alignment: .top, spacing: SnoutTheme.Spacing.md) {
                    creditColumn(value: full, label: full == 1 ? "Full day" : "Full days")
                    Divider().background(SnoutTheme.divider).frame(height: 44)
                    creditColumn(value: half, label: half == 1 ? "Half day" : "Half days")
                    Divider().background(SnoutTheme.divider).frame(height: 44)
                    creditColumn(value: nights, label: nights == 1 ? "Night" : "Nights")
                }
            } else {
                Text("No credits on your account yet. Your facility can add a package when you book.")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .snoutTinted(SnoutTheme.cotton)
    }

    private func creditColumn(value: Int, label: String) -> some View {
        VStack(spacing: 4) {
            Text("\(value)")
                .font(SnoutTheme.display(32, weight: .regular))
                .foregroundStyle(SnoutTheme.onSurface)
            Text(label)
                .font(SnoutTheme.labelMD)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Hero card (compact dimensions)

private struct HeroCard: View {
    let tint: Color
    let eyebrow: String
    let headline: String
    let subhead: String
    let symbol: String
    let badge: String?

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
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

            HStack(alignment: .center, spacing: SnoutTheme.Spacing.md) {
                ZStack {
                    Circle()
                        .fill(SnoutTheme.surface)
                        .frame(width: 48, height: 48)
                    Image(systemName: symbol)
                        .font(.system(size: 22))
                        .foregroundStyle(SnoutTheme.accent)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(headline)
                        .font(SnoutTheme.titleMD)
                        .foregroundStyle(SnoutTheme.onSurface)
                    Text(subhead)
                        .font(SnoutTheme.bodySM)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                Spacer()
            }
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(tint.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusTile, style: .continuous))
        .shadow(color: SnoutTheme.cardShadowColor,
                radius: SnoutTheme.cardShadowRadius, x: 0, y: SnoutTheme.cardShadowY)
    }
}

#Preview {
    HomeView()
        .environmentObject(CurrentOwnerService())
        .environmentObject(UnreadMessagesService())
}
