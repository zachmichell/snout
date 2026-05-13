//
//  SettingsView.swift  (declares `MoreView`)
//  Snout
//
//  The "More" tab — sectioned hub for everything that isn't a top-level
//  workflow:
//
//    Account     · Client details, Payment methods
//    Pets        · My pets (add / edit / delete)
//    Billing     · Invoices (paid + unpaid)
//    Documents   · Agreements (sign on device, view signed)
//    Library     · Report cards, Cameras
//    --          · Sign out
//
//  Sub-pages live in apps/ios/Snout/Views/More/:
//    - ClientDetailsView.swift
//    - PetsView.swift           (PetsListView + PetEditView)
//    - InvoicesView.swift       (InvoicesListView + InvoiceDetailView + Stripe Checkout)
//    - AgreementsView.swift     (AgreementsListView + AgreementDetailView + PencilKit)
//    - PaymentMethodsView.swift (list, set default, remove)
//    - MoreShared.swift         (BohoFormField, BohoSegmented, BohoMultilineField,
//                                ComingSoonPlaceholder, SafariSheet)
//
//  Filename note: source file is still SettingsView.swift because renaming
//  requires either an XcodeGen regen pass or a manual pbxproj edit. The
//  struct rename to `MoreView` is the only part that actually matters for
//  the UI; file rename is cleanup for a later turn.
//

import SwiftUI

struct MoreView: View {
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var currentOwner: CurrentOwnerService

    @State private var orgName: String?

    var body: some View {
        NavigationStack {
            ZStack {
                SnoutTheme.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: SnoutTheme.Spacing.xl) {
                        profileCard
                        accountSection
                        petsSection
                        billingSection
                        documentsSection
                        librarySection
                        signOutCard
                        Spacer(minLength: SnoutTheme.Spacing.xxl)
                    }
                    .padding(.horizontal, SnoutTheme.Spacing.xl)
                    .padding(.top, SnoutTheme.Spacing.md)
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("More")
            .navigationBarTitleDisplayMode(.large)
            .task { await loadOrgName() }
        }
    }

    // MARK: - Profile

    private var profileCard: some View {
        HStack(spacing: SnoutTheme.Spacing.lg) {
            ZStack {
                Circle().fill(SnoutTheme.cotton).frame(width: 64, height: 64)
                Text(initials)
                    .font(SnoutTheme.body(22, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(fullName)
                    .font(SnoutTheme.titleMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                if let org = orgName {
                    Text(org)
                        .font(SnoutTheme.bodySM)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                if let email = currentOwner.owner?.email {
                    Text(email)
                        .font(SnoutTheme.labelSM)
                        .foregroundStyle(SnoutTheme.onSurfaceFaint)
                }
            }
            Spacer()
        }
        .snoutCard()
    }

    private var fullName: String {
        guard let owner = currentOwner.owner else { return "Pet parent" }
        return "\(owner.firstName) \(owner.lastName)"
    }

    private var initials: String {
        guard let owner = currentOwner.owner else { return "P" }
        let f = owner.firstName.first.map(String.init) ?? ""
        let l = owner.lastName.first.map(String.init) ?? ""
        return (f + l).uppercased()
    }

    // MARK: - Section card wrappers

    private func sectionCard<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            Text(title.uppercased())
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .padding(.horizontal, SnoutTheme.Spacing.xs)
            VStack(spacing: SnoutTheme.Spacing.md) {
                content()
            }
            .snoutCard()
        }
    }

    private func navSection<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            Text(title.uppercased())
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .padding(.horizontal, SnoutTheme.Spacing.xs)
            VStack(spacing: 0) {
                content()
            }
            .snoutCard(padding: 0)
        }
    }

    // MARK: - Account section

    private var accountSection: some View {
        navSection(title: "Account") {
            navRow(
                title: "Client details",
                body: "Name, phone, address, email",
                symbol: "person.text.rectangle",
                tint: SnoutTheme.cotton
            ) { ClientDetailsView() }
            Divider().background(SnoutTheme.divider)
            navRow(
                title: "Payment methods",
                body: "Cards on file",
                symbol: "creditcard",
                tint: SnoutTheme.vanilla
            ) { PaymentMethodsView() }
        }
    }

    // MARK: - Pets

    private var petsSection: some View {
        navSection(title: "Pets") {
            navRow(
                title: "My pets",
                body: "Add, edit, or remove pets",
                symbol: "pawprint",
                tint: SnoutTheme.mist
            ) { PetsListView() }
        }
    }

    // MARK: - Billing

    private var billingSection: some View {
        navSection(title: "Billing") {
            navRow(
                title: "Invoices",
                body: "Paid and unpaid history",
                symbol: "doc.text",
                tint: SnoutTheme.frost
            ) { InvoicesListView() }
        }
    }

    // MARK: - Documents

    private var documentsSection: some View {
        navSection(title: "Documents") {
            navRow(
                title: "Agreements",
                body: "Sign and review facility agreements",
                symbol: "signature",
                tint: SnoutTheme.blueberry
            ) { AgreementsListView() }
        }
    }

    // MARK: - Library

    private var librarySection: some View {
        navSection(title: "Library") {
            navRow(
                title: "Report cards",
                body: "Photos and notes from each visit",
                symbol: "photo.on.rectangle",
                tint: SnoutTheme.vanilla
            ) { ReportCardListView() }
            Divider().background(SnoutTheme.divider)
            navRow(
                title: "Cameras",
                body: "Live view of your facility's cams",
                symbol: "video.fill",
                tint: SnoutTheme.frost
            ) { WebcamListView() }
        }
    }

    // MARK: - Reusable nav row

    @ViewBuilder
    private func navRow<Destination: View>(
        title: String,
        body: String,
        symbol: String,
        tint: Color,
        @ViewBuilder destination: @escaping () -> Destination
    ) -> some View {
        NavigationLink(destination: destination) {
            HStack(spacing: SnoutTheme.Spacing.lg) {
                ZStack {
                    Circle().fill(tint).frame(width: 40, height: 40)
                    // SnoutGlyph picks up the custom Boho asset when one
                    // exists in Assets.xcassets/Glyphs and falls back to
                    // the SF Symbol of the same name otherwise.
                    SnoutGlyph(symbol, size: 16, weight: .semibold)
                        .foregroundStyle(SnoutTheme.onSurface)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(SnoutTheme.body(16, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                    Text(body)
                        .font(SnoutTheme.bodySM)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                Spacer()
                SnoutGlyph("chevron.right", size: 13, weight: .semibold)
                    .foregroundStyle(SnoutTheme.onSurfaceFaint)
            }
            .padding(SnoutTheme.Spacing.lg)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Sign out

    private var signOutCard: some View {
        Button {
            Task { await auth.signOut() }
        } label: {
            HStack {
                SnoutGlyph("rectangle.portrait.and.arrow.right", size: 16, weight: .semibold)
                Text("Sign out")
                    .font(SnoutTheme.body(16, weight: .semibold))
                Spacer()
            }
            .foregroundStyle(SnoutTheme.onSurface)
            .snoutCard()
        }
        .buttonStyle(.plain)
    }

    // MARK: - Org load

    private func loadOrgName() async {
        guard let orgId = currentOwner.organizationId else { return }
        do {
            struct Org: Decodable { let name: String }
            let rows: [Org] = try await SupabaseClientProvider.shared
                .from("organizations")
                .select("name")
                .eq("id", value: orgId)
                .limit(1)
                .execute()
                .value
            orgName = rows.first?.name
        } catch {
            // Non-fatal — leave nil.
        }
    }

}
