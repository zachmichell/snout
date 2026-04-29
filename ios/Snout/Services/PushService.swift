//
//  PushService.swift
//  Snout
//
//  Stub for APNS-via-FCM push notifications. The server-side bridge isn't built yet
//  (see docs/IOS_APP_SPEC.md §7), so right now this:
//   1. Requests notification permission so the iOS habit is right.
//   2. Calls registerForRemoteNotifications, which gives us an APNS token locally.
//   3. Logs that we'd POST the token to /functions/register-device-token.
//
//  Once the backend lands `device_tokens` table, the FCM SDK, and the
//  `register-device-token` edge function, we'll:
//   - Add the firebase-ios-sdk SPM dependency (FirebaseMessaging product only).
//   - Set Messaging.messaging().apnsToken from didRegisterForRemoteNotifications.
//   - Implement MessagingDelegate.didReceiveRegistrationToken to POST the FCM token.
//
//  Until then, calling `requestPermissionAndRegister` is safe but the server won't fan
//  out push events to this device.
//

import Foundation
import UserNotifications
import UIKit

@MainActor
final class PushService: NSObject, ObservableObject {
    @Published private(set) var permissionStatus: UNAuthorizationStatus = .notDetermined

    func refreshPermissionStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        permissionStatus = settings.authorizationStatus
    }

    func requestPermissionAndRegister() async {
        do {
            let granted = try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .badge, .sound])
            if granted {
                UIApplication.shared.registerForRemoteNotifications()
            }
            await refreshPermissionStatus()
        } catch {
            // Permission errors are not fatal; user can re-enable from Settings.
        }
    }

    /// Stub. Replace with the FCM token POST once the backend bridge is built.
    func registerDeviceToken(_ apnsToken: Data) {
        let hex = apnsToken.map { String(format: "%02x", $0) }.joined()
        // TODO: POST to /functions/register-device-token once the edge function exists.
        // For now this is just a debug breadcrumb.
        print("[PushService] APNS token received (\(hex.count) hex chars). Bridge not yet built.")
    }
}
