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

/// Minimal invoice projection for the Home unpaid banner. The full Invoice
/// model lives in Models/ and gets built in the turn that ports the Invoices
/// list page; for now we only need the few fields the banner reads.
///
/// "Unpaid" = invoice_status IN ('sent', 'partial', 'overdue'). We deliberately
/// exclude 'draft' (facility hasn't issued it yet) and 'void' (cancelled).
struct UnpaidInvoiceSummary: Decodable, Identifiable {
    let id: String
    let invoiceNumber: String?
    let status: String
    let totalCents: Int
    let amountPaidCents: Int
    let currency: String
    let dueAt: Date?

    var amountOwedCents: Int { max(0, totalCents - amountPaidCents) }

    enum CodingKeys: String, CodingKey {
        case id
        case invoiceNumber = "invoice_number"
        case status
        case totalCents = "total_cents"
        case amountPaidCents = "amount_paid_cents"
        case currency
        case dueAt = "due_at"
    }
}

@MainActor
final class HomeViewModel: ObservableObject {
    @Published var pets: [Pet] = []
    @Published var activeReservation: Reservation?     // checked_in right now
    @Published var nextReservation: Reservation?       // upcoming
    @Published var orgName: String?
    @Published var locations: [Location] = []
    @Published var unpaidInvoices: [UnpaidInvoiceSummary] = []
    @Published var isLoading: Bool = false

    private let client = SupabaseClientProvider.shared

    func load(organizationId: String, ownerId: String) async {
        isLoading = true
        defer { isLoading = false }

        async let petsTask: [Pet] = loadPets(ownerId: ownerId)
        async let reservationsTask: [Reservation] = loadReservations(ownerId: ownerId)
        async let orgTask: String? = loadOrgName(organizationId: organizationId)
        async let locationsTask: [Location] = loadLocations(organizationId: organizationId)
        async let unpaidTask: [UnpaidInvoiceSummary] = loadUnpaidInvoices(ownerId: ownerId)

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
        self.unpaidInvoices = (try? await unpaidTask) ?? []
    }

    /// Total amount owed across all unpaid invoices (cents).
    var totalUnpaidCents: Int {
        unpaidInvoices.reduce(0) { $0 + $1.amountOwedCents }
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

    /// Pull invoices the parent owes money on. Status filter mirrors the web
    /// portal's unpaid view: 'sent' (issued, not yet paid), 'partial' (some
    /// payment received but not in full), 'overdue' (past due_at). We sort by
    /// due_at ascending so the most-overdue one appears first in any UI.
    private func loadUnpaidInvoices(ownerId: String) async throws -> [UnpaidInvoiceSummary] {
        try await client
            .from("invoices")
            .select("id, invoice_number, status, total_cents, amount_paid_cents, currency, due_at")
            .eq("owner_id", value: ownerId)
            .is("deleted_at", value: nil)
            .in("status", values: ["sent", "partial", "overdue"])
            .order("due_at", ascending: true)
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
                        // Unpaid-invoice nudge sits BEFORE the greeting because
                        // the user explicitly asked for emphasis on outstanding
                        // balances. Hidden when there's nothing owed.
                        unpaidInvoicesBanner
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

    // MARK: - Unpaid invoices banner
    //
    // Pet-parent's first stop on Home when they owe money. We deliberately
    // pick a warm but elevated treatment — cotton-pink card, full-width,
    // a circular icon tile in the brand `accent` (Soft Camel) so it reads
    // as "actionable" rather than "error". Tapping pushes into the More tab's
    // Invoices list.
    //
    // Visibility: hidden entirely when there are no unpaid invoices, so
    // there's zero noise for parents up to date. When one or more exist,
    // the banner is the first interactive element on the page.

    @ViewBuilder
    private var unpaidInvoicesBanner: some View {
        if !vm.unpaidInvoices.isEmpty {
            NavigationLink(destination: InvoicesListView()) {
                HStack(spacing: SnoutTheme.Spacing.lg) {
                    ZStack {
                        Circle().fill(SnoutTheme.accent).frame(width: 44, height: 44)
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(SnoutTheme.onAccent)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(unpaidHeadline)
                            .font(SnoutTheme.body(15, weight: .semibold))
                            .foregroundStyle(SnoutTheme.onSurface)
                        Text(unpaidSubhead)
                            .font(SnoutTheme.bodySM)
                            .foregroundStyle(SnoutTheme.onSurfaceMuted)
                            .lineLimit(2)
                    }
                    Spacer()
                    SnoutGlyph("chevron.right", size: 14, weight: .semibold)
                        .foregroundStyle(SnoutTheme.onSurface)
                }
                .padding(SnoutTheme.Spacing.lg)
                .background(SnoutTheme.cotton.opacity(0.85))
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusTile, style: .continuous))
                .shadow(color: SnoutTheme.cardShadowColor,
                        radius: SnoutTheme.cardShadowRadius,
                        x: 0, y: SnoutTheme.cardShadowY)
            }
            .buttonStyle(.plain)
        }
    }

    private var unpaidHeadline: String {
        let count = vm.unpaidInvoices.count
        let amount = Money.formatCents(vm.totalUnpaidCents,
                                       currency: vm.unpaidInvoices.first?.currency ?? "CAD")
        if count == 1 {
            return "Invoice due · \(amount)"
        }
        return "\(count) invoices due · \(amount)"
    }

    private var unpaidSubhead: String {
        // Surface the most pressing one (earliest due_at). Already sorted
        // ascending by the loader, so .first is the most overdue / soonest.
        guard let first = vm.unpaidInvoices.first else {
            return "Tap to review and pay"
        }
        if let due = first.dueAt {
            let cal = Calendar.current
            let days = cal.dateComponents([.day], from: cal.startOfDay(for: Date()),
                                          to: cal.startOfDay(for: due)).day ?? 0
            if days < 0   { return "Past due — please pay as soon as possible" }
            if days == 0  { return "Due today — tap to review and pay" }
            if days == 1  { return "Due tomorrow — tap to review and pay" }
            if days <= 7  { return "Due in \(days) days — tap to review and pay" }
            return "Tap to review and pay"
        }
        return "Tap to review and pay"
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
            pet: pet,
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
            pet: pet,
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
            pet: pet,
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
            pet: nil,
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
                Text("No credits on your account yet. Buy a package to lock in discounted visits.")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Buy-more CTA — outlined when credits exist (so the existing
            // counts stay the visual focus), filled accent when empty (so
            // the path forward is unmistakable). Pushes to BuyCreditsView
            // via the navigation stack.
            NavigationLink {
                BuyCreditsView()
            } label: {
                HStack(spacing: SnoutTheme.Spacing.sm) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 14, weight: .semibold))
                    Text(hasAny ? "Buy more credits" : "Buy credits")
                        .font(SnoutTheme.body(14, weight: .semibold))
                }
                .foregroundStyle(hasAny ? SnoutTheme.onSurface : SnoutTheme.onAccent)
                .frame(maxWidth: .infinity)
                .padding(.vertical, SnoutTheme.Spacing.sm)
                .background(hasAny ? SnoutTheme.surface : SnoutTheme.accent)
                .clipShape(Capsule())
                .overlay(
                    hasAny
                        ? Capsule().stroke(SnoutTheme.divider, lineWidth: 1)
                        : nil
                )
            }
            .buttonStyle(.plain)
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
    /// Symbol used when `pet` is nil (welcome / empty states). When a pet
    /// is present we always show the pet's photo (or initial fallback).
    let symbol: String
    let pet: Pet?
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
                // Pet present → real avatar (photo or initial). No pet →
                // SF symbol on a white surface tile (welcome / setup state).
                if pet != nil {
                    PetAvatar(pet: pet, size: 48, tintOverride: SnoutTheme.surface)
                } else {
                    ZStack {
                        Circle()
                            .fill(SnoutTheme.surface)
                            .frame(width: 48, height: 48)
                        // SnoutGlyph routes through the asset catalog, so
                        // pawprint.circle.fill / calendar.circle.fill /
                        // house.circle.fill resolve to whichever Boho
                        // artwork the catalog has aliased to those names.
                        SnoutGlyph(symbol, size: 22)
                            .foregroundStyle(SnoutTheme.accent)
                    }
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
