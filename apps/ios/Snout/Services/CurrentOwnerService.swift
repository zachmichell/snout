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
        // Trust the userId: AuthService gave it to us from a validated session
        // (either the bootstrap keychain read or a fresh signIn). supabase-swift's
        // PostgREST client pulls the bearer token from client.auth at request time,
        // so if there's a session it'll be attached. If there isn't one, the query
        // fails and we surface the real error rather than guessing.
        //
        // (Previously this had a 10-attempt × progressive-delay retry loop that
        // waited up to ~8 seconds for client.auth.session to resolve. That was
        // overcautious — the session is already in the keychain by the time signIn()
        // returns — and it made every transient PostgREST error look like a
        // "session missing" error to the user. Removed 2026-04-29.)
        //
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
            // Surface the actual error verbatim so RLS / auth / network failures are
            // diagnosable from the UI rather than being masked behind a generic message.
            print("[CurrentOwnerService] owners query failed for profile=\(normalizedId): \(error)")
            loadError = "Couldn't load your account: \(error.localizedDescription)"
        }
    }

    /// Re-fetches the current owner row from the database. Use this after actions
    /// that change owner-cached fields (e.g. credit consumption updates the
    /// `daycare_full_day_credits` columns via a trigger). Keeps the same ownerId
    /// — does not re-resolve from userId.
    func refreshOwner() async {
        guard let id = ownerId else { return }
        do {
            let rows: [Owner] = try await client
                .from("owners")
                .select()
                .eq("id", value: id)
                .is("deleted_at", value: nil)
                .limit(1)
                .execute()
                .value
            if let fresh = rows.first {
                owner = fresh
            }
        } catch {
            // Non-fatal — leave the cached owner in place.
        }
    }

    func reset() {
        ownerId = nil
        organizationId = nil
        owner = nil
        loadError = nil
    }
}
