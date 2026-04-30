//
//  MainTabView.swift
//  Snout
//
//  Tab bar order: Home · Messages · Book · Calendar · Settings.
//  - Cameras and Report Cards live in Settings → Library (not top-level tabs).
//
//  We deliberately do NOT use SwiftUI's TabView. On iOS 17 the system tab bar's
//  background material can leak through behind a custom floating bar even when
//  `.toolbar(.hidden, for: .tabBar)` and `.toolbarBackground(.hidden, for: .tabBar)`
//  are both applied. Replacing TabView with a ZStack switcher eliminates the
//  system bar entirely.
//
//  State preservation across tab switches: tabs the user has visited stay alive
//  in the hierarchy with opacity 0 and hit-testing off. Tabs they haven't visited
//  yet are not instantiated until first selection — so we don't fire all five
//  `.task` modifiers at app launch.
//

import SwiftUI

struct MainTabView: View {
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var unread = UnreadMessagesService()
    @StateObject private var tabBarVisibility = TabBarVisibility()
    @State private var selection: Int = 0
    /// Tabs the user has visited at least once; only these are rendered.
    @State private var visited: Set<Int> = [0]

    private static let items: [SnoutTabItem] = [
        .init(icon: "house",                          label: "Home"),
        .init(icon: "bubble.left.and.bubble.right",   label: "Messages"),
        .init(icon: "plus.circle.fill",               label: "Book"),
        .init(icon: "calendar",                       label: "Calendar"),
        .init(icon: "person.crop.circle",             label: "Settings")
    ]

    var body: some View {
        ZStack(alignment: .bottom) {
            // Full-bleed background that fills below the tab bar's safe area too.
            SnoutTheme.background.ignoresSafeArea()

            // Tab content stack. Visible tab is opaque + hit-testable; others
            // are kept in memory but invisible/inert.
            ZStack {
                tab(0) { HomeView() }
                tab(1) { ConversationListView() }
                tab(2) { BookView() }
                tab(3) { CalendarView() }
                tab(4) { SettingsView() }
            }
            // Reserve room at the bottom for the floating tab bar so content
            // doesn't slide under it. Inset collapses to 0 when the bar is
            // hidden (e.g. pushed into a ConversationView) so the deeper view
            // gets full-screen space.
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear
                    .frame(height: tabBarVisibility.isVisible ? 70 : 0)
            }

            // Floating custom tab bar — only at the root of a tab.
            if tabBarVisibility.isVisible {
                CustomTabBar(
                    selection: $selection,
                    items: Self.items,
                    unreadCounts: [1: unread.count]
                )
                .padding(.bottom, 8)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.22), value: tabBarVisibility.isVisible)
        .onChange(of: selection) { _, newValue in
            visited.insert(newValue)
        }
        .task(id: currentOwner.ownerId) {
            await unread.refresh(ownerId: currentOwner.ownerId)
        }
        .environmentObject(unread)
        .environmentObject(tabBarVisibility)
        .tint(SnoutTheme.accent)
    }

    @ViewBuilder
    private func tab<Content: View>(_ index: Int, @ViewBuilder content: () -> Content) -> some View {
        if visited.contains(index) {
            content()
                .opacity(selection == index ? 1 : 0)
                .allowsHitTesting(selection == index)
        }
    }
}

#Preview {
    MainTabView()
        .environmentObject(AuthService())
        .environmentObject(CurrentOwnerService())
}
