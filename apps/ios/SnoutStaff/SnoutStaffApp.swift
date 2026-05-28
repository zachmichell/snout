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
    var body: some Scene {
        WindowGroup {
            StaffRootView()
        }
    }
}
