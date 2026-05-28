//
//  StaffPushService.swift
//  Snout Staff
//
//  Requests notification permission, registers for remote (APNs)
//  notifications, and upserts the device token into device_tokens after
//  sign-in. The send-push edge function (built next) reads that table and
//  delivers via APNs. A singleton so the UIApplicationDelegate (which
//  receives the token callback) and SwiftUI can share state.
//
//  Note: push only actually *delivers* once the app is code-signed with the
//  Push Notifications capability (aps-environment entitlement) and the APNs
//  key is configured server-side. Until then this is a harmless no-op on
//  simulator / unsigned builds — the token callback just won't fire.
//

import Foundation
import UserNotifications
import UIKit
import Supabase

@MainActor
final class StaffPushService: NSObject, ObservableObject {
    static let shared = StaffPushService()

    @Published private(set) var permission: UNAuthorizationStatus = .notDetermined

    private var profileId: String?
    private var organizationId: String?
    private var pendingTokenHex: String?
    private let client = SupabaseClientProvider.shared

    private override init() { super.init() }

    /// Call once the staff member is signed in + resolved. Requests
    /// permission, registers for remote notifications, and remembers who to
    /// attribute the token to. If a token already arrived before we knew the
    /// user (race on launch), it's flushed now.
    func start(profileId: String, organizationId: String?) {
        self.profileId = profileId
        self.organizationId = organizationId
        UNUserNotificationCenter.current().delegate = self

        Task {
            let center = UNUserNotificationCenter.current()
            let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
            permission = (await center.notificationSettings()).authorizationStatus
            if granted { UIApplication.shared.registerForRemoteNotifications() }
            if let hex = pendingTokenHex { await upsert(tokenHex: hex) }
        }
    }

    /// Forwarded from the app delegate's didRegisterForRemoteNotifications.
    func didRegister(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        pendingTokenHex = hex
        guard profileId != nil else { return } // flushed on start()
        Task { await upsert(tokenHex: hex) }
    }

    private func upsert(tokenHex: String) async {
        guard let profileId else { return }
        struct Row: Encodable {
            let profile_id: String
            let organization_id: String?
            let token: String
            let platform: String
            let bundle_id: String?
            let app: String
            let last_seen_at: String
            let deleted_at: String?
        }
        let row = Row(
            profile_id: profileId,
            organization_id: organizationId,
            token: tokenHex,
            platform: "apns",
            bundle_id: Bundle.main.bundleIdentifier,
            app: "staff",
            last_seen_at: ISO8601DateFormatter().string(from: Date()),
            deleted_at: nil
        )
        do {
            try await client.from("device_tokens").upsert(row, onConflict: "token").execute()
        } catch {
            #if DEBUG
            print("[StaffPushService] device_tokens upsert failed: \(error)")
            #endif
        }
    }
}

extension StaffPushService: UNUserNotificationCenterDelegate {
    /// Show banners even while the app is foregrounded.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }

    /// v1: tapping a notification just foregrounds the app. Deep-linking to
    /// the relevant lane from the payload is a later enhancement.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
    }
}
