//
//  RootView.swift
//  Snout
//
//  Top-level auth gate. Three states:
//    .unknown    — boot screen while we figure out auth state
//    .signedOut  — sign-in surface
//    .signedIn   — wait for currentOwner to resolve, THEN show MainTabView.
//                  Without this gate, tab views fire data loads before the
//                  session is hydrated and hit "auth session missing".
//

import SwiftUI

struct RootView: View {
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var currentOwner: CurrentOwnerService

    var body: some View {
        switch auth.state {
        case .unknown:
            bootSplash
        case .signedOut:
            SignInView()
                .onAppear { currentOwner.reset() }
        case .signedIn(let userId):
            signedInGate(userId: userId)
        }
    }

    // MARK: - Boot

    private var bootSplash: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ProgressView().tint(SnoutTheme.accent)
        }
    }

    // MARK: - Signed-in gate

    @ViewBuilder
    private func signedInGate(userId: String) -> some View {
        if currentOwner.ownerId != nil {
            MainTabView()
        } else if let err = currentOwner.loadError {
            ownerLoadError(err, userId: userId)
        } else {
            ownerLoading
                .task { await currentOwner.loadIfNeeded(userId: userId) }
        }
    }

    private var ownerLoading: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            VStack(spacing: SnoutTheme.Spacing.md) {
                ProgressView().tint(SnoutTheme.accent)
                Text("Getting things ready…")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
        }
    }

    private func ownerLoadError(_ message: String, userId: String) -> some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            VStack(spacing: SnoutTheme.Spacing.lg) {
                SnoutGlyph("exclamationmark.triangle", size: 40)
                    .foregroundStyle(SnoutTheme.accent)
                Text("Couldn't load your account")
                    .font(SnoutTheme.titleMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                Text(message)
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, SnoutTheme.Spacing.xl)
                Button {
                    Task {
                        currentOwner.reset()
                        await currentOwner.loadIfNeeded(userId: userId)
                    }
                } label: {
                    Text("Try again")
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onAccent)
                        .padding(.horizontal, SnoutTheme.Spacing.xl)
                        .padding(.vertical, SnoutTheme.Spacing.md)
                        .background(SnoutTheme.accent)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                Button {
                    Task { try? await SupabaseClientProvider.shared.auth.signOut() }
                } label: {
                    Text("Sign out")
                        .font(SnoutTheme.body(14, weight: .medium))
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
            }
            .padding(SnoutTheme.Spacing.xl)
        }
    }
}

#Preview {
    RootView()
        .environmentObject(AuthService())
        .environmentObject(CurrentOwnerService())
}
