//
//  SnoutStaffApp.swift
//  Snout Staff
//
//  Entry point for the staff/operator app — used by owners, admins,
//  managers, supervisors, staff, groomers, and trainers to run the
//  business from a phone or iPad. Shares the Supabase backend, data
//  models, and Boho theme with the client app (see project.yml: this
//  target compiles the shared files under Snout/ alongside SnoutStaff/).
//

import SwiftUI
import UIKit

/// Bridges UIKit's APNs token callback into StaffPushService. SwiftUI's
/// App lifecycle doesn't surface didRegisterForRemoteNotifications, so we
/// install a thin app delegate.
final class StaffAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in StaffPushService.shared.didRegister(deviceToken: deviceToken) }
    }
    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        #if DEBUG
        print("[StaffAppDelegate] APNs registration failed: \(error.localizedDescription)")
        #endif
    }
}

@main
struct SnoutStaffApp: App {
    @UIApplicationDelegateAdaptor(StaffAppDelegate.self) private var appDelegate
    @StateObject private var auth = AuthService()
    @StateObject private var staff = CurrentStaffService()
    @StateObject private var lock = AppLockService()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            StaffRootView()
                .environmentObject(auth)
                .environmentObject(staff)
                .environmentObject(lock)
                .tint(SnoutTheme.accent)
                // The Boho palette is light-only (matches the client app); without
                // this, system chrome (tab bar, the >5-tab "More" overflow list)
                // flips to dark mode and clashes with the cream theme.
                .preferredColorScheme(.light)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                // Lock on background so the app-switcher snapshot hides client
                // data; records the time for the grace window.
                lock.lock()
            case .active:
                // Returning within the grace window clears the lock silently;
                // a longer absence still requires Face ID.
                lock.resumeIfWithinGrace()
            default:
                break
            }
        }
    }
}
