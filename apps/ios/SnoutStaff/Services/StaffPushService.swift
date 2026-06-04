//
//  StaffPushService.swift
//  Snout Staff
//
//  Requests notification permission, registers for remote (APNs)
//  notifications, and upserts the device token into device_tokens after
//  sign-in. The send-staff-push edge function reads that table and
//  delivers via APNs. A singleton so the UIApplicationDelegate (which
//  receives the token callback) and SwiftUI can share state.
//
//  Push only actually *delivers* once: (1) the app is code-signed with
//  the Push Notifications capability (aps-environment entitlement), (2)
//  the provisioning profile carries the same capability, and (3) the
//  APNs key is configured on Supabase. The published `Diagnostic`
//  surface makes it possible to see at a glance where the chain is
//  breaking without scraping logs — wired into StaffMoreView so testers
//  can self-serve.
//

import Foundation
import UserNotifications
import UIKit
import Supabase

@MainActor
final class StaffPushService: NSObject, ObservableObject {
    static let shared = StaffPushService()

    /// Snapshot of the push pipeline's state. Read from StaffMoreView's
    /// "Push diagnostics" panel; all fields are safe to display to a
    /// signed-in staff user.
    struct Diagnostic: Equatable {
        var permission: UNAuthorizationStatus = .notDetermined
        var registrationAttempts: Int = 0      // how many times we've called registerForRemoteNotifications
        var lastTokenReceivedAt: Date?         // didRegister callback fired
        var lastTokenSuffix: String?           // last 8 hex chars of token, for cross-checking
        var lastUpsertSucceededAt: Date?
        var lastUpsertFailureAt: Date?
        var lastError: String?
    }

    @Published private(set) var diagnostic: Diagnostic = .init()

    /// Convenience alias kept for any view binding on permission alone.
    var permission: UNAuthorizationStatus { diagnostic.permission }

    private var profileId: String?
    private var organizationId: String?
    private var pendingTokenHex: String?
    private let client = SupabaseClientProvider.shared

    private override init() { super.init() }

    /// Call once the staff member is signed in + resolved. Idempotent —
    /// safe to call on every sign-in or app launch.
    ///
    /// The key behavior change from the v1 implementation: we always call
    /// `registerForRemoteNotifications` when the OS-recorded status is
    /// `authorized` or `provisional`, not only when the just-fired prompt
    /// returned granted=true. On any re-launch after a prior grant, the
    /// prompt does not appear and the old code path skipped registration,
    /// which silently broke token delivery whenever a build added or
    /// changed the aps-environment entitlement after the original prompt.
    func start(profileId: String, organizationId: String?) {
        self.profileId = profileId
        self.organizationId = organizationId
        UNUserNotificationCenter.current().delegate = self

        Task {
            let center = UNUserNotificationCenter.current()
            let current = await center.notificationSettings()

            // requestAuthorization shows the system prompt ONLY when the
            // status is still .notDetermined; calling it later is harmless
            // but doesn't surface anything. Branch on the OS-recorded
            // status so the rest of this flow reads the truth.
            if current.authorizationStatus == .notDetermined {
                _ = try? await center.requestAuthorization(options: [.alert, .badge, .sound])
            }
            let resolved = await center.notificationSettings()
            diagnostic.permission = resolved.authorizationStatus

            if resolved.authorizationStatus == .authorized
                || resolved.authorizationStatus == .provisional {
                diagnostic.registrationAttempts += 1
                UIApplication.shared.registerForRemoteNotifications()
            }

            // Flush a token that arrived before we knew who the user was
            // (rare but possible if the OS delivers the token before the
            // staff service resolves the profile).
            if let hex = pendingTokenHex { await upsert(tokenHex: hex) }
        }
    }

    /// Forwarded from the app delegate's didRegisterForRemoteNotifications.
    func didRegister(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        pendingTokenHex = hex
        diagnostic.lastTokenReceivedAt = Date()
        diagnostic.lastTokenSuffix = String(hex.suffix(8))
        guard profileId != nil else { return } // flushed on start()
        Task { await upsert(tokenHex: hex) }
    }

    /// Forwarded from didFailToRegisterForRemoteNotifications. APNs
    /// outright refuses to mint a token here — usually a signing /
    /// provisioning profile capability mismatch, occasionally a transient
    /// network issue.
    func didFailToRegister(error: Error) {
        diagnostic.lastError = "APNs register failed: \(error.localizedDescription)"
        diagnostic.lastUpsertFailureAt = Date()
    }

    /// Manual retry from the diagnostics panel. Re-arms the chain without
    /// requiring a sign-out / sign-in cycle.
    func retryRegistration() async {
        let center = UNUserNotificationCenter.current()
        let resolved = await center.notificationSettings()
        diagnostic.permission = resolved.authorizationStatus
        if resolved.authorizationStatus == .authorized
            || resolved.authorizationStatus == .provisional {
            diagnostic.registrationAttempts += 1
            UIApplication.shared.registerForRemoteNotifications()
        }
        if let hex = pendingTokenHex { await upsert(tokenHex: hex) }
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
            diagnostic.lastUpsertSucceededAt = Date()
            diagnostic.lastError = nil
        } catch {
            // Clip the error so the diagnostics panel doesn't try to
            // render multi-screen Postgres error envelopes.
            let raw = String(describing: error)
            diagnostic.lastError = String(raw.prefix(240))
            diagnostic.lastUpsertFailureAt = Date()
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
