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

@main
struct SnoutStaffApp: App {
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
        }
        .onChange(of: scenePhase) { _, phase in
            // Re-lock whenever the app leaves the foreground so returning
            // to it requires Face ID again.
            if phase == .background {
                lock.lock()
            }
        }
    }
}
