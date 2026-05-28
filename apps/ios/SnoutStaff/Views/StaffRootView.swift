//
//  StaffRootView.swift
//  Snout Staff
//
//  Top-level router: auth state -> (login | loading | staff home), gated by
//  the biometric app lock once signed in. A customer-only login is rejected
//  with a "this app is for staff" screen.
//

import SwiftUI

struct StaffRootView: View {
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var staff: CurrentStaffService
    @EnvironmentObject private var lock: AppLockService

    var body: some View {
        ZStack {
            content
            if isSignedIn && lock.isLocked {
                LockView()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: lock.isLocked)
    }

    private var isSignedIn: Bool {
        if case .signedIn = auth.state { return true }
        return false
    }

    @ViewBuilder
    private var content: some View {
        switch auth.state {
        case .unknown:
            LoadingScreen(message: "Loading…")
        case .signedOut:
            StaffLoginView()
        case .signedIn(let userId):
            signedInContent(userId: userId)
        }
    }

    @ViewBuilder
    private func signedInContent(userId: String) -> some View {
        switch staff.state {
        case .idle, .loading:
            LoadingScreen(message: "Signing you in…")
                .task { await staff.loadIfNeeded(userId: userId) }
        case .staff(let role, let org):
            StaffHomeShell(role: role)
                .task {
                    if let pid = staff.profileId {
                        StaffPushService.shared.start(profileId: pid, organizationId: org)
                    }
                }
        case .notStaff:
            NotStaffGate()
        case .error(let message):
            ErrorScreen(message: message) {
                Task { await staff.load(userId: userId) }
            }
        }
    }
}

private struct LoadingScreen: View {
    let message: String
    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            VStack(spacing: SnoutTheme.Spacing.md) {
                ProgressView().tint(SnoutTheme.accent)
                Text(message)
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
        }
    }
}

private struct LockView: View {
    @EnvironmentObject private var lock: AppLockService
    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            VStack(spacing: SnoutTheme.Spacing.lg) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 36))
                    .foregroundStyle(SnoutTheme.onSurface)
                Text("Snout Staff is locked")
                    .font(SnoutTheme.titleMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                Button {
                    Task { await lock.authenticate() }
                } label: {
                    Text("Unlock")
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onAccent)
                        .padding(.horizontal, SnoutTheme.Spacing.xl)
                        .padding(.vertical, SnoutTheme.Spacing.md)
                        .background(SnoutTheme.accent)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .task { await lock.authenticate() }
    }
}

private struct NotStaffGate: View {
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var staff: CurrentStaffService
    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            VStack(spacing: SnoutTheme.Spacing.md) {
                Image(systemName: "person.badge.shield.exclamationmark")
                    .font(.system(size: 32))
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                Text("Staff access only")
                    .font(SnoutTheme.titleMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                Text("This app is for facility staff. If you're a pet parent, please use the Snout app instead.")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, SnoutTheme.Spacing.xl)
                Button {
                    Task { await auth.signOut(); staff.reset() }
                } label: {
                    Text("Sign out")
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                        .padding(.horizontal, SnoutTheme.Spacing.xl)
                        .padding(.vertical, SnoutTheme.Spacing.md)
                        .background(SnoutTheme.surface)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SnoutTheme.divider, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .padding(.top, SnoutTheme.Spacing.sm)
            }
            .padding(SnoutTheme.Spacing.xl)
        }
    }
}

private struct ErrorScreen: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            VStack(spacing: SnoutTheme.Spacing.md) {
                Text("Couldn't load your account")
                    .font(SnoutTheme.titleMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                Text(message)
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, SnoutTheme.Spacing.xl)
                Button(action: retry) {
                    Text("Try again")
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onAccent)
                        .padding(.horizontal, SnoutTheme.Spacing.xl)
                        .padding(.vertical, SnoutTheme.Spacing.md)
                        .background(SnoutTheme.accent)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }
}
