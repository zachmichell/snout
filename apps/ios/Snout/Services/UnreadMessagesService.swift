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

import Foundation
import Supabase

@MainActor
final class UnreadMessagesService: ObservableObject {
    @Published private(set) var count: Int = 0

    private let client = SupabaseClientProvider.shared

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

    func reset() {
        count = 0
    }
}
