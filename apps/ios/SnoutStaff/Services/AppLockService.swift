//
//  AppLockService.swift
//  Snout Staff
//
//  Face ID / Touch ID gate. The staff app shows client PII, so we lock it
//  behind biometrics when it launches and whenever it returns from the
//  background. If the device has no biometrics enrolled (or the user
//  declines), we fall back to device passcode; if neither is available the
//  lock is a no-op (can't lock out a device with no auth configured).
//
//  Opt-in: `enabled` is persisted; when off, the app never locks. Defaults on.
//

import Foundation
import LocalAuthentication

@MainActor
final class AppLockService: ObservableObject {
    /// True when the app is currently locked and content should be hidden.
    @Published private(set) var isLocked: Bool
    /// User preference — persisted. When false the lock never engages.
    @Published var enabled: Bool {
        didSet { UserDefaults.standard.set(enabled, forKey: Self.enabledKey) }
    }

    private static let enabledKey = "snoutstaff.applock.enabled"

    /// How long the app may sit in the background before it re-challenges.
    /// Returning within this window clears the lock without a biometric prompt
    /// (so locking your phone and coming right back doesn't re-ask for Face ID).
    private let graceInterval: TimeInterval = 120
    private var lastBackgrounded: Date?

    init() {
        let on = UserDefaults.standard.object(forKey: Self.enabledKey) as? Bool ?? true
        enabled = on
        isLocked = on   // start locked if enabled
    }

    /// Whether the device can actually evaluate a biometric/passcode policy.
    var biometryAvailable: Bool {
        var error: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    }

    /// Engage the lock (e.g. when entering the background). No-op if disabled.
    /// Records when we backgrounded so a quick return can skip the prompt.
    func lock() {
        guard enabled else { return }
        lastBackgrounded = Date()
        isLocked = true
    }

    /// Called when the app returns to the foreground: if we were only
    /// backgrounded briefly, clear the lock silently (no Face ID prompt).
    func resumeIfWithinGrace() {
        guard enabled, isLocked, let since = lastBackgrounded else { return }
        if Date().timeIntervalSince(since) <= graceInterval {
            lastBackgrounded = nil
            isLocked = false
        }
    }

    /// Prompt for Face ID / Touch ID (falling back to passcode). On success,
    /// clears the lock. If the device can't evaluate any policy, we unlock so
    /// the app stays usable rather than bricking.
    func authenticate() async {
        guard enabled else { isLocked = false; return }

        // Brief background → skip the biometric challenge (grace window). Acts
        // as a fallback in case the lock screen's auto-prompt fires before the
        // foreground resume handler.
        if let since = lastBackgrounded, Date().timeIntervalSince(since) <= graceInterval {
            lastBackgrounded = nil
            isLocked = false
            return
        }

        let context = LAContext()
        context.localizedFallbackTitle = "Use passcode"

        var policyError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) else {
            // No biometrics/passcode configured — don't trap the user out.
            isLocked = false
            return
        }

        do {
            let ok = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Unlock Snout Staff"
            )
            isLocked = !ok
        } catch {
            // User cancelled or failed — stay locked; they can retry.
            isLocked = true
        }
    }
}
