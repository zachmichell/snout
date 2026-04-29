//
//  SnoutApp.swift
//  Snout
//
//  Pet-parent companion app. Same Supabase backend as the web product (Snout.app).
//  See ../docs/IOS_APP_SPEC.md for scope and architecture.
//

import SwiftUI

@main
struct SnoutApp: App {
    @StateObject private var auth = AuthService()
    @StateObject private var currentOwner = CurrentOwnerService()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(auth)
                .environmentObject(currentOwner)
                .tint(SnoutTheme.accent)
                .preferredColorScheme(.light) // v1 — dark mode comes later
        }
    }
}
