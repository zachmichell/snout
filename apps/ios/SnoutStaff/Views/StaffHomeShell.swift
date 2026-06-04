//
//  StaffHomeShell.swift
//  Snout Staff
//
//  The signed-in shell — a ZStack tab-switcher (no stock SwiftUI TabView)
//  with the floating cream `CustomTabBar` shared with the client app. The
//  stock TabView's >5-tab "More" overflow was an unthemed system table that
//  rendered black in dark mode; this replaces it with a styled
//  `StaffMoreView` hub that lists the overflow lanes as Boho nav cards.
//
//  Role-aware tab split:
//    • lanes ≤ 5  → show all directly.
//    • lanes  > 5 → first 4 primary + a "More" tab (the styled hub) for the
//                   rest. Owner/admin/manager have 7 lanes, so Reports /
//                   Messages / Search land in More.
//
//  Tabs are lazy-loaded — only visited tabs are instantiated; visited tabs
//  stay alive (opacity 0, hit-testing off) so their state persists across
//  switches. Mirrors the client app's MainTabView pattern.
//

import SwiftUI

struct StaffHomeShell: View {
    let role: StaffRole
    @State private var selection: Int
    @State private var visited: Set<Int>
    @State private var showAccount = false

    init(role: StaffRole) {
        self.role = role
        let allLanes = StaffPermissions.capabilities(for: role)
        let defaultIndex = allLanes.firstIndex(of: StaffPermissions.defaultHome(for: role)) ?? 0
        _selection = State(initialValue: defaultIndex)
        _visited = State(initialValue: [defaultIndex])
    }

    // MARK: - Role-aware tab split

    private var lanes: [StaffCapability] { StaffPermissions.capabilities(for: role) }
    private var primaryLanes: [StaffCapability] {
        lanes.count <= 5 ? lanes : Array(lanes.prefix(4))
    }
    private var overflowLanes: [StaffCapability] {
        lanes.count <= 5 ? [] : Array(lanes.dropFirst(4))
    }
    private var hasMore: Bool { !overflowLanes.isEmpty }
    private var moreIndex: Int { primaryLanes.count }

    private var tabItems: [SnoutTabItem] {
        var items = primaryLanes.map { SnoutTabItem(icon: laneSymbol($0), label: laneTitle($0)) }
        if hasMore {
            items.append(SnoutTabItem(icon: "ellipsis.circle.fill", label: "More"))
        }
        return items
    }

    // MARK: - Body

    var body: some View {
        ZStack(alignment: .bottom) {
            SnoutTheme.background.ignoresSafeArea()

            ZStack {
                ForEach(primaryLanes.indices, id: \.self) { index in
                    primaryTab(index)
                }
                if hasMore { moreTab }
            }
            // Reserve room at the bottom for the floating bar so content
            // doesn't slide under it. Matches the client's MainTabView.
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear.frame(height: 70)
            }

            CustomTabBar(selection: $selection, items: tabItems)
                .padding(.bottom, 8)
        }
        .onChange(of: selection) { _, newValue in
            visited.insert(newValue)
        }
        .sheet(isPresented: $showAccount) { AccountSheet() }
    }

    @ViewBuilder
    private func primaryTab(_ index: Int) -> some View {
        if visited.contains(index) {
            NavigationStack {
                laneContent(primaryLanes[index])
                    .navigationTitle(laneTitle(primaryLanes[index]))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { accountToolbar }
            }
            .opacity(selection == index ? 1 : 0)
            .allowsHitTesting(selection == index)
        }
    }

    @ViewBuilder
    private var moreTab: some View {
        if visited.contains(moreIndex) {
            NavigationStack {
                StaffMoreView(
                    lanes: overflowLanes,
                    laneTitle: laneTitle,
                    laneSymbol: laneSymbol,
                    laneSubtitle: laneSubtitle,
                    laneTint: laneTint,
                    laneContent: { AnyView(laneContent($0)) }
                )
                .navigationTitle("More")
                .navigationBarTitleDisplayMode(.large)
                .toolbar { accountToolbar }
            }
            .opacity(selection == moreIndex ? 1 : 0)
            .allowsHitTesting(selection == moreIndex)
        }
    }

    @ToolbarContentBuilder
    private var accountToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button { showAccount = true } label: {
                Image(systemName: "person.crop.circle")
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
        }
    }

    // MARK: - Lane → view + metadata

    /// Real screen for lanes that are built; placeholder for the rest.
    @ViewBuilder
    private func laneContent(_ lane: StaffCapability) -> some View {
        switch lane {
        case .dashboard:   StaffDashboardView()
        case .schedule:    StaffScheduleView()
        case .grooming:    StaffGroomingView()
        case .training:    StaffTrainingView()
        case .reportCards: StaffReportsView()
        case .messaging:   StaffMessagingView()
        case .petsOwners:  StaffLookupView()
        default:           LanePlaceholderView(lane: lane)
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
        // Names without ".fill" match the custom Boho imagesets in
        // Assets.xcassets/Glyphs (house, doc.text, calendar, etc.) and
        // SnoutGlyph prefers those over the SF Symbol. Earlier this
        // function used the "<name>.fill" SF Symbol names, which had no
        // custom asset → fell back to SF Symbols → some symbols (house.fill,
        // doc.text.fill) rendered blank in the staff tab bar / More hub.
        // Using the base names lets every site pick up the brand glyph
        // automatically.
        switch lane {
        case .dashboard:   return "house"
        case .schedule:    return "calendar"
        case .grooming:    return "scissors"
        case .training:    return "graduationcap"
        case .reportCards: return "doc.text"
        case .messaging:   return "message"
        case .petsOwners:  return "magnifyingglass"
        case .pos:         return "creditcard"
        case .analytics:   return "chart.bar"
        case .shifts:      return "clock"
        }
    }

    private func laneSubtitle(_ lane: StaffCapability) -> String {
        switch lane {
        case .dashboard:   return "Business overview"
        case .schedule:    return "Today's pack"
        case .grooming:    return "Grooming appointments"
        case .training:    return "Classes and attendance"
        case .reportCards: return "Write report cards and log care"
        case .messaging:   return "Message pet parents"
        case .petsOwners:  return "Look up pets and owners"
        case .pos:         return "Point of sale"
        case .analytics:   return "Trends and reports"
        case .shifts:      return "Staff shifts"
        }
    }

    private func laneTint(_ lane: StaffCapability) -> Color {
        switch lane {
        case .dashboard:   return SnoutTheme.cotton
        case .schedule:    return SnoutTheme.blueberry
        case .grooming:    return SnoutTheme.cotton
        case .training:    return SnoutTheme.mist
        case .reportCards: return SnoutTheme.vanilla
        case .messaging:   return SnoutTheme.frost
        case .petsOwners:  return SnoutTheme.mist
        default:           return SnoutTheme.vanilla
        }
    }
}

// MARK: - Styled More hub (mirrors the client's MoreView)

private struct StaffMoreView: View {
    let lanes: [StaffCapability]
    let laneTitle: (StaffCapability) -> String
    let laneSymbol: (StaffCapability) -> String
    let laneSubtitle: (StaffCapability) -> String
    let laneTint: (StaffCapability) -> Color
    let laneContent: (StaffCapability) -> AnyView

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
                    VStack(spacing: 0) {
                        ForEach(lanes.indices, id: \.self) { i in
                            let lane = lanes[i]
                            NavigationLink {
                                laneContent(lane)
                                    .navigationTitle(laneTitle(lane))
                                    .navigationBarTitleDisplayMode(.inline)
                            } label: {
                                navRow(lane: lane)
                            }
                            .buttonStyle(.plain)
                            if i < lanes.count - 1 {
                                Divider()
                                    .background(SnoutTheme.divider)
                                    .padding(.leading, 76)
                            }
                        }
                    }
                    .snoutCard(padding: 0)
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(.horizontal, SnoutTheme.Spacing.xl)
                .padding(.top, SnoutTheme.Spacing.md)
            }
            .scrollContentBackground(.hidden)
        }
    }

    private func navRow(lane: StaffCapability) -> some View {
        HStack(spacing: SnoutTheme.Spacing.lg) {
            ZStack {
                Circle().fill(laneTint(lane)).frame(width: 40, height: 40)
                SnoutGlyph(laneSymbol(lane), size: 16, weight: .semibold)
                    .foregroundStyle(SnoutTheme.onSurface)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(laneTitle(lane))
                    .font(SnoutTheme.body(16, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                Text(laneSubtitle(lane))
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
            Spacer()
            SnoutGlyph("chevron.right", size: 13, weight: .semibold)
                .foregroundStyle(SnoutTheme.onSurfaceFaint)
        }
        .padding(SnoutTheme.Spacing.lg)
    }
}

// MARK: - Push diagnostics panel
//
// Surfaces the StaffPushService state so a tester can see whether the
// push chain is reaching their phone without scraping device logs or
// asking an engineer. Lives in More because it's a "tools" surface, not
// a daily-use lane.

private struct PushDiagnosticsPanel: View {
    @StateObject private var push = StaffPushService.shared

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            HStack(spacing: SnoutTheme.Spacing.md) {
                ZStack {
                    Circle().fill(SnoutTheme.frost).frame(width: 36, height: 36)
                    SnoutGlyph("bell.fill", size: 14, weight: .semibold)
                        .foregroundStyle(SnoutTheme.onSurface)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Push diagnostics")
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                    Text("Notification permission, last APNs token, last server upsert")
                        .font(SnoutTheme.bodySM)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                Spacer()
            }

            Divider().background(SnoutTheme.divider)

            row("Permission", value: permissionLabel, valueColor: permissionTint)
            row("Registration attempts", value: "\(push.diagnostic.registrationAttempts)")
            row("Last APNs token", value: tokenLabel)
            row("Last server upsert", value: upsertLabel, valueColor: upsertTint)

            if let err = push.diagnostic.lastError, !err.isEmpty {
                Divider().background(SnoutTheme.divider)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Last error")
                        .font(SnoutTheme.labelSM)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    Text(err)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(Color.red.opacity(0.85))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Button {
                Task { await push.retryRegistration() }
            } label: {
                HStack(spacing: SnoutTheme.Spacing.sm) {
                    SnoutGlyph("arrow.clockwise", size: 12, weight: .semibold)
                    Text("Retry registration")
                        .font(SnoutTheme.body(13, weight: .semibold))
                }
                .foregroundStyle(SnoutTheme.onSurface)
                .padding(.horizontal, SnoutTheme.Spacing.md)
                .padding(.vertical, SnoutTheme.Spacing.sm)
                .background(SnoutTheme.vanilla)
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .padding(.top, SnoutTheme.Spacing.xs)
        }
        .padding(SnoutTheme.Spacing.lg)
        .snoutCard(padding: 0)
    }

    private func row(_ label: String, value: String, valueColor: Color = SnoutTheme.onSurface) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(SnoutTheme.bodySM)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            Spacer(minLength: SnoutTheme.Spacing.md)
            Text(value)
                .font(SnoutTheme.body(13, weight: .medium))
                .foregroundStyle(valueColor)
                .multilineTextAlignment(.trailing)
        }
    }

    private var permissionLabel: String {
        switch push.diagnostic.permission {
        case .authorized:   return "Allowed"
        case .denied:       return "Denied (Settings → Snout Staff → Notifications)"
        case .provisional:  return "Provisional"
        case .ephemeral:    return "Ephemeral"
        case .notDetermined: return "Not yet requested"
        @unknown default:   return "Unknown"
        }
    }

    private var permissionTint: Color {
        switch push.diagnostic.permission {
        case .authorized, .provisional: return SnoutTheme.onSurface
        case .denied: return .red
        default: return SnoutTheme.onSurfaceMuted
        }
    }

    private var tokenLabel: String {
        guard let received = push.diagnostic.lastTokenReceivedAt else { return "Never" }
        let suffix = push.diagnostic.lastTokenSuffix ?? ""
        return "\(received.formatted(.dateTime.hour().minute()))  …\(suffix)"
    }

    private var upsertLabel: String {
        if let ok = push.diagnostic.lastUpsertSucceededAt {
            return "OK · \(ok.formatted(.dateTime.hour().minute()))"
        }
        if let fail = push.diagnostic.lastUpsertFailureAt {
            return "Failed · \(fail.formatted(.dateTime.hour().minute()))"
        }
        return "Never"
    }

    private var upsertTint: Color {
        if push.diagnostic.lastUpsertSucceededAt != nil { return SnoutTheme.onSurface }
        if push.diagnostic.lastUpsertFailureAt != nil { return .red }
        return SnoutTheme.onSurfaceMuted
    }
}

// MARK: - Placeholder for lanes that aren't built yet

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

// MARK: - Account sheet

private struct AccountSheet: View {
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var staff: CurrentStaffService
    @EnvironmentObject private var lock: AppLockService
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                SnoutTheme.background.ignoresSafeArea()
                ScrollView {
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

                        // Visible to every role: shows whether push notifications
                        // have permission, whether APNs has handed us a token,
                        // and whether the device_tokens upsert succeeded. Lets
                        // testers self-diagnose without scraping logs.
                        PushDiagnosticsPanel()

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
                        .padding(.top, SnoutTheme.Spacing.md)
                    }
                    .padding(SnoutTheme.Spacing.xl)
                }
                .scrollContentBackground(.hidden)
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
