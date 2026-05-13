//
//  UnreadMessagesService.swift
//  Snout
//
//  Lightweight observable that publishes the pet-parent's total unread message
//  count across all their conversations. Drives the badge on the Messages tab.
//
//  We keep this separate from `HomeViewModel` because the badge needs to live as
//  long as MainTabView is on screen — it can't be tied to the lifecycle of a
//  single tab's view.
//
//  Live updates: subscribes to `conversations` row changes filtered to this
//  owner. Whenever a new staff message arrives, the DB bumps
//  `conversations.unread_owner`, the subscription fires, and we re-fetch the
//  count so the tab badge updates without the user pulling to refresh or
//  re-opening the app. Subscription is torn down + re-established when the
//  owner ID changes (sign in / out / multi-account future).
//

import Foundation
import Supabase

@MainActor
final class UnreadMessagesService: ObservableObject {
    @Published private(set) var count: Int = 0

    private let client = SupabaseClientProvider.shared
    private var realtimeChannel: RealtimeChannelV2?
    private var realtimeOwnerId: String?

    /// Re-reads the unread count from the server. Safe to call at any time.
    /// Owner-less calls zero out the badge (used on sign-out).
    func refresh(ownerId: String?) async {
        guard let ownerId else {
            count = 0
            return
        }
        do {
            struct Conv: Decodable { let unread_owner: Int }
            let rows: [Conv] = try await client
                .from("conversations")
                .select("unread_owner")
                .eq("owner_id", value: ownerId)
                .execute()
                .value
            count = rows.reduce(0) { $0 + $1.unread_owner }
        } catch {
            // Non-fatal: leave the previous count in place rather than zeroing
            // the badge on a transient network blip.
        }
    }

    /// Begin listening for live changes on this owner's conversations.
    /// Idempotent — calling with the same owner is a no-op; calling with a
    /// different owner tears down the previous channel and starts fresh.
    /// Pair with `stopRealtime()` on sign-out for a clean tear-down.
    func startRealtime(ownerId: String) async {
        if realtimeOwnerId == ownerId, realtimeChannel != nil { return }

        // Tear down any previous channel (different owner, or stale state)
        if let existing = realtimeChannel {
            await existing.unsubscribe()
            realtimeChannel = nil
        }

        let channel = client.realtimeV2.channel("unread-conversations:\(ownerId)")
        // Subscribe to any change on this owner's conversations rows. The
        // DB-side trigger that increments `unread_owner` on new staff
        // messages fires an UPDATE event here; a brand-new conversation
        // would fire INSERT. Both should bump the badge.
        let updates = channel.postgresChange(
            UpdateAction.self,
            schema: "public",
            table: "conversations",
            filter: .eq("owner_id", value: ownerId)
        )
        let inserts = channel.postgresChange(
            InsertAction.self,
            schema: "public",
            table: "conversations",
            filter: .eq("owner_id", value: ownerId)
        )
        try? await channel.subscribeWithError()
        realtimeChannel = channel
        realtimeOwnerId = ownerId

        // Fan both streams into the same refresh handler. Each pass re-reads
        // the count from the server rather than trying to diff payloads —
        // simpler and avoids drift if a payload is missed for any reason.
        Task { [weak self] in
            for await _ in updates {
                guard let self else { break }
                await self.refresh(ownerId: ownerId)
            }
        }
        Task { [weak self] in
            for await _ in inserts {
                guard let self else { break }
                await self.refresh(ownerId: ownerId)
            }
        }
    }

    /// Tear down the realtime subscription. Call from sign-out so we don't
    /// keep a channel open for a stale owner identity.
    func stopRealtime() async {
        if let channel = realtimeChannel {
            await channel.unsubscribe()
            realtimeChannel = nil
        }
        realtimeOwnerId = nil
    }

    func reset() {
        count = 0
    }
}
