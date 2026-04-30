//
//  TabBarVisibility.swift
//  Snout
//
//  Shared visibility state for the custom floating bottom tab bar in MainTabView.
//
//  Standard iOS UX: the tab bar is shown when the user is at the *root* of a
//  tab's NavigationStack and hidden when they push deeper (so the pushed view
//  gets the full screen — important for conversation composers, photo viewers,
//  full-screen detail layouts, etc.).
//
//  SwiftUI's built-in TabView handles this via `.toolbar(.hidden, for: .tabBar)`,
//  but our custom switcher doesn't use TabView, so we need an explicit signal.
//
//  Usage in a pushed view:
//
//      struct ConversationView: View {
//          @EnvironmentObject private var tabBar: TabBarVisibility
//          var body: some View {
//              ...
//              .onAppear  { tabBar.isVisible = false }
//              .onDisappear { tabBar.isVisible = true }
//          }
//      }
//

import Foundation
import SwiftUI

@MainActor
final class TabBarVisibility: ObservableObject {
    @Published var isVisible: Bool = true
}
