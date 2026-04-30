//
//  SettingsView.swift
//  Snout
//
//  Profile header with initials avatar in a Boho tile, owner name, org name,
//  followed by app meta and a separated sign-out action.
//

import SwiftUI

struct SettingsView: View {
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
                        librarySection
                        sectionCard(title: "App") {
                            row(label: "Version", value: appVersion)
                            Divider().background(SnoutTheme.divider)
                            row(label: "Build", value: buildNumber)
                        }
                        signOutCard
                        Spacer(minLength: SnoutTheme.Spacing.xxl)
                    }
                    .padding(.horizontal, SnoutTheme.Spacing.xl)
                    .padding(.top, SnoutTheme.Spacing.md)
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Settings")
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

    // MARK: - Section card

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

    // MARK: - Library section (report cards lives here since it left the tab bar)

    private var librarySection: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            Text("LIBRARY")
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .padding(.horizontal, SnoutTheme.Spacing.xs)
            VStack(spacing: 0) {
                libraryRow(
                    title: "Report cards",
                    body: "Photos and notes from each visit",
                    symbol: "photo.on.rectangle",
                    tint: SnoutTheme.vanilla
                ) {
                    ReportCardListView()
                }
                Divider().background(SnoutTheme.divider)
                libraryRow(
                    title: "Cameras",
                    body: "Live view of your facility's cams",
                    symbol: "video.fill",
                    tint: SnoutTheme.frost
                ) {
                    WebcamListView()
                }
            }
            .snoutCard(padding: 0)
        }
    }

    @ViewBuilder
    private func libraryRow<Destination: View>(
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
                    Image(systemName: symbol)
                        .font(.system(size: 16, weight: .semibold))
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
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurfaceFaint)
            }
            .padding(SnoutTheme.Spacing.lg)
        }
        .buttonStyle(.plain)
    }

    private func row(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
            Spacer()
            Text(value)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
        }
    }

    // MARK: - Sign out

    private var signOutCard: some View {
        Button {
            Task { await auth.signOut() }
        } label: {
            HStack {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                    .font(.system(size: 16, weight: .semibold))
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

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
    }

    private var buildNumber: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
    }
}
