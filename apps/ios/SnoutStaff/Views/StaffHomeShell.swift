//
//  StaffHomeShell.swift
//  Snout Staff
//
//  The signed-in shell: a tab bar whose tabs are the lanes available to the
//  user's role, opening on their default home. Lane content is placeholder
//  for now — the real screens (schedule/check-in-out, grooming day, class
//  day, report cards/care logs, messaging, pets/owners lookup) land in the
//  feature-lanes task. This file owns the role→lane wiring + the account
//  sheet (name, role, app-lock toggle, sign out).
//

import SwiftUI

struct StaffHomeShell: View {
    let role: StaffRole
    @State private var selection: StaffCapability
    @State private var showAccount = false

    init(role: StaffRole) {
        self.role = role
        _selection = State(initialValue: StaffPermissions.defaultHome(for: role))
    }

    private var lanes: [StaffCapability] { StaffPermissions.capabilities(for: role) }

    var body: some View {
        TabView(selection: $selection) {
            ForEach(lanes, id: \.self) { lane in
                NavigationStack {
                    laneContent(lane)
                        .navigationTitle(laneTitle(lane))
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button {
                                    showAccount = true
                                } label: {
                                    Image(systemName: "person.crop.circle")
                                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                                }
                            }
                        }
                }
                .tabItem {
                    Label(laneTitle(lane), systemImage: laneSymbol(lane))
                }
                .tag(lane)
            }
        }
        .tint(SnoutTheme.accent)
        .sheet(isPresented: $showAccount) {
            AccountSheet()
        }
    }

    /// Real screen for lanes that are built; placeholder for the rest.
    @ViewBuilder
    private func laneContent(_ lane: StaffCapability) -> some View {
        switch lane {
        case .schedule:
            StaffScheduleView()
        case .grooming:
            StaffGroomingView()
        case .training:
            StaffTrainingView()
        case .reportCards:
            StaffReportsView()
        case .messaging:
            StaffMessagingView()
        case .petsOwners:
            StaffLookupView()
        default:
            LanePlaceholderView(lane: lane)
        }
    }

    private func laneTitle(_ lane: StaffCapability) -> String {
        switch lane {
        case .dashboard:   return "Home"
        case .schedule:    return "Today"
        case .grooming:    return "Grooming"
        case .training:    return "Classes"
        case .reportCards: return "Reports"
        case .messaging:   return "Messages"
        case .petsOwners:  return "Search"
        case .pos:         return "POS"
        case .analytics:   return "Analytics"
        case .shifts:      return "Shifts"
        }
    }

    private func laneSymbol(_ lane: StaffCapability) -> String {
        switch lane {
        case .dashboard:   return "house.fill"
        case .schedule:    return "calendar"
        case .grooming:    return "scissors"
        case .training:    return "graduationcap.fill"
        case .reportCards: return "doc.text.fill"
        case .messaging:   return "message.fill"
        case .petsOwners:  return "magnifyingglass"
        case .pos:         return "creditcard.fill"
        case .analytics:   return "chart.bar.fill"
        case .shifts:      return "clock.fill"
        }
    }
}

/// Temporary per-lane placeholder until the real feature screens land.
private struct LanePlaceholderView: View {
    let lane: StaffCapability
    @EnvironmentObject private var staff: CurrentStaffService

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            VStack(spacing: SnoutTheme.Spacing.md) {
                Spacer()
                Image(systemName: "hammer.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(SnoutTheme.onSurfaceFaint)
                Text(blurb)
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, SnoutTheme.Spacing.xl)
                Text("Coming soon")
                    .font(SnoutTheme.labelSM)
                    .tracking(0.8)
                    .foregroundStyle(SnoutTheme.onSurface)
                    .padding(.horizontal, SnoutTheme.Spacing.lg)
                    .padding(.vertical, SnoutTheme.Spacing.sm)
                    .background(SnoutTheme.vanilla)
                    .clipShape(Capsule())
                Spacer()
            }
        }
    }

    private var blurb: String {
        switch lane {
        case .dashboard:
            let name = staff.displayName.isEmpty ? "there" : staff.displayName
            return "Welcome, \(name). Your business overview lands here."
        case .schedule:    return "Today's pack and check-in / check-out."
        case .grooming:    return "Your grooming appointments for the day."
        case .training:    return "Your classes, rosters, and attendance."
        case .reportCards: return "Write report cards and log care."
        case .messaging:   return "Message pet parents."
        case .petsOwners:  return "Look up pets and owners."
        default:           return "Coming in a later phase."
        }
    }
}

private struct AccountSheet: View {
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var staff: CurrentStaffService
    @EnvironmentObject private var lock: AppLockService
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                SnoutTheme.background.ignoresSafeArea()
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
                    VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
                        Text(staff.displayName.isEmpty ? "Signed in" : staff.displayName)
                            .font(SnoutTheme.titleMD)
                            .foregroundStyle(SnoutTheme.onSurface)
                        if let role = staff.role {
                            Text(role.label.uppercased())
                                .font(SnoutTheme.labelSM)
                                .tracking(0.8)
                                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                        }
                    }

                    if lock.biometryAvailable {
                        Toggle(isOn: $lock.enabled) {
                            Text("Require Face ID / passcode to open")
                                .font(SnoutTheme.bodyMD)
                                .foregroundStyle(SnoutTheme.onSurface)
                        }
                        .tint(SnoutTheme.accent)
                        .padding(SnoutTheme.Spacing.md)
                        .background(SnoutTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
                    }

                    Spacer()

                    Button {
                        Task {
                            await auth.signOut()
                            staff.reset()
                        }
                    } label: {
                        Text("Sign out")
                            .font(SnoutTheme.body(15, weight: .semibold))
                            .foregroundStyle(SnoutTheme.destructive)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, SnoutTheme.Spacing.md)
                            .background(SnoutTheme.surface)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(SnoutTheme.destructive.opacity(0.4), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(SnoutTheme.accent)
                }
            }
        }
    }
}
