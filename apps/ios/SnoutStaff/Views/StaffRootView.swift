//
//  StaffRootView.swift
//  Snout Staff
//
//  Scaffolding root. For now it's a themed splash that confirms the shared
//  theme + Supabase client are wired into this target. The real shell —
//  auth, role-specific home routing, and the Face ID lock — lands next
//  (see the auth/role task). Kept deliberately tiny so the target compiles
//  on its own while the rest is built out.
//

import SwiftUI
import Supabase

struct StaffRootView: View {
    // Touch the shared client so we fail fast at build time if the shared
    // infra (AppConfig + SupabaseClient) isn't wired into this target.
    private let client: SupabaseClient = SupabaseClientProvider.shared

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            VStack(spacing: SnoutTheme.Spacing.sm) {
                Text("Snout")
                    .font(SnoutTheme.display(44, weight: .bold))
                    .foregroundStyle(SnoutTheme.onSurface)
                Text("STAFF")
                    .font(SnoutTheme.labelSM)
                    .tracking(3)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
        }
    }
}

#Preview {
    StaffRootView()
}
