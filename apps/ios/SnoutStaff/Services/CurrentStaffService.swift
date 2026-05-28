//
//  CurrentStaffService.swift
//  Snout Staff
//
//  After auth, resolves the signed-in user's staff membership (role + org)
//  and profile. Mirrors CurrentOwnerService in the client app, but for the
//  staff side: a customer-only login is rejected with `.notStaff` so pet
//  parents are pointed back to the client app.
//

import Foundation
import Supabase

@MainActor
final class CurrentStaffService: ObservableObject {
    enum State: Equatable {
        case idle
        case loading
        case staff(role: StaffRole, organizationId: String)
        case notStaff          // signed in, but no active non-customer membership
        case error(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var displayName: String = ""
    @Published private(set) var profileId: String?

    private let client = SupabaseClientProvider.shared

    var role: StaffRole? {
        if case let .staff(role, _) = state { return role }
        return nil
    }
    var organizationId: String? {
        if case let .staff(_, org) = state { return org }
        return nil
    }

    func loadIfNeeded(userId: String) async {
        if case .staff = state { return }
        await load(userId: userId)
    }

    func load(userId: String) async {
        state = .loading
        let uid = userId.lowercased()
        profileId = uid
        do {
            // Active, non-customer memberships for this user. If they belong to
            // more than one org we take the first active staff membership for
            // v1 (org switching is a later concern).
            let memberships: [Membership] = try await client
                .from("memberships")
                .select("organization_id, role, active")
                .eq("profile_id", value: uid)
                .eq("active", value: true)
                .execute()
                .value

            let staffMembership = memberships.first { ($0.role != "customer") }
            guard let m = staffMembership, let role = StaffRole(rawValue: m.role), role.isStaff else {
                state = .notStaff
                return
            }

            // Best-effort name for the header; non-fatal if it fails.
            await loadDisplayName(uid: uid)

            state = .staff(role: role, organizationId: m.organizationId)
        } catch {
            print("[CurrentStaffService] membership load failed for \(uid): \(error)")
            state = .error(error.localizedDescription)
        }
    }

    private func loadDisplayName(uid: String) async {
        do {
            let rows: [Profile] = try await client
                .from("profiles")
                .select()
                .eq("id", value: uid)
                .limit(1)
                .execute()
                .value
            if let p = rows.first {
                let name = [p.firstName, p.lastName].compactMap { $0 }.joined(separator: " ")
                displayName = name.isEmpty ? (p.email ?? "") : name
            }
        } catch {
            // Non-fatal; header just shows nothing.
        }
    }

    func reset() {
        state = .idle
        displayName = ""
        profileId = nil
    }
}
