//
//  CurrentOwnerService.swift
//  Snout
//
//  After auth, we need the owner row for the signed-in profile in the user's organization.
//  Pet parents have role = 'customer' in a single org per the spec; we resolve that membership
//  then look up the owner record.
//

import Foundation
import Supabase

@MainActor
final class CurrentOwnerService: ObservableObject {
    @Published private(set) var ownerId: String?
    @Published private(set) var organizationId: String?
    @Published private(set) var owner: Owner?
    @Published private(set) var loadError: String?

    private let client = SupabaseClientProvider.shared

    /// Caller passes the userId from AuthService.state. We use it directly rather than
    /// going through client.auth.user() / client.auth.session, both of which can race
    /// the keychain restore on launch.
    func loadIfNeeded(userId: String) async {
        guard ownerId == nil else { return }
        await load(userId: userId)
    }

    func load(userId: String) async {
        // Wait briefly for the keychain session to hydrate. Without a session in
        // client.auth, PostgREST requests go out without a bearer token and RLS
        // sees auth.uid() = NULL, so policies that compare profile_id = auth.uid()
        // never match.
        var session: Session?
        for attempt in 0..<10 {
            do {
                session = try await client.auth.session
                break
            } catch {
                let delayNs = UInt64(150_000_000) * UInt64(attempt + 1)
                try? await Task.sleep(nanoseconds: delayNs)
            }
        }
        guard session != nil else {
            loadError = "Couldn't restore your sign-in session. Please sign out and try again."
            return
        }

        // Use the lowercased UUID. supabase-swift returns UUID().uuidString in uppercase,
        // but Postgres stores UUIDs lowercased and PostgREST's eq filter is a literal
        // string match before the database re-parses.
        let normalizedId = userId.lowercased()

        do {
            let owners: [Owner] = try await client
                .from("owners")
                .select()
                .eq("profile_id", value: normalizedId)
                .is("deleted_at", value: nil)
                .limit(1)
                .execute()
                .value
            guard let firstOwner = owners.first else {
                loadError = "Your account isn't linked to a pet parent record yet. Contact your facility."
                return
            }
            owner = firstOwner
            ownerId = firstOwner.id
            organizationId = firstOwner.organizationId
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    func reset() {
        ownerId = nil
        organizationId = nil
        owner = nil
        loadError = nil
    }
}
