//
//  MainTabView.swift
//  Snout
//
//  Five tabs. Cameras live inside Home as a contextual tile rather than a
//  permanent tab — they only show up when relevant (org-wide cams or active visit).
//

import SwiftUI

struct MainTabView: View {
    @EnvironmentObject private var auth: AuthService

    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Home", systemImage: "house") }

            ReservationListView()
                .tabItem { Label("Visits", systemImage: "calendar") }

            ReportCardListView()
                .tabItem { Label("Cards", systemImage: "photo.on.rectangle") }

            ConversationListView()
                .tabItem { Label("Messages", systemImage: "bubble.left.and.bubble.right") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "person.crop.circle") }
        }
        .tint(SnoutTheme.accent)
    }
}

#Preview {
    MainTabView()
        .environmentObject(AuthService())
        .environmentObject(CurrentOwnerService())
}
