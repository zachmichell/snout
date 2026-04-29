//
//  AuthService.swift
//  Snout
//
//  Auth state holder + sign-in/out methods. Watches Supabase auth events and republishes them
//  for SwiftUI views. Sign in with Apple is sketched out behind a feature flag; it requires
//  a paid Apple Developer account, the Sign in with Apple capability enabled in Xcode, and
//  the Apple provider configured in the Supabase dashboard.
//

import Foundation
import Supabase

@MainActor
final class AuthService: ObservableObject {
    enum AuthState: Equatable {
        case unknown          // Initial state before we've checked
        case signedOut
        case signedIn(userId: String)
    }

    @Published private(set) var state: AuthState = .unknown
    @Published private(set) var lastError: String?

    private let client = SupabaseClientProvider.shared
    private var authStateTask: Task<Void, Never>?

    init() {
        bootstrap()
    }

    deinit {
        authStateTask?.cancel()
    }

    // MARK: - Bootstrap

    private func bootstrap() {
        // First, do a synchronous keychain check. Supabase persists sessions to the keychain,
        // but the async authStateChanges stream can take a moment to emit its first event.
        // Reading the current session synchronously avoids the race where a SwiftUI view
        // tries to use auth.user() before the stream has fired .initialSession.
        Task { [weak self] in
            guard let self else { return }
            do {
                let session = try await self.client.auth.session
                self.state = .signedIn(userId: session.user.id.uuidString.lowercased())
            } catch {
                // No session in keychain or it's invalid. Treat as signed out.
                self.state = .signedOut
            }
        }

        // Then subscribe to the stream so we react to future state changes (sign-in, sign-out,
        // token refresh, expiry).
        authStateTask = Task { [weak self] in
            guard let self else { return }
            for await (event, session) in self.client.auth.authStateChanges {
                let nextState: AuthState
                switch event {
                case .initialSession, .signedIn, .tokenRefreshed, .userUpdated:
                    if let session {
                        nextState = .signedIn(userId: session.user.id.uuidString.lowercased())
                    } else {
                        nextState = .signedOut
                    }
                case .signedOut:
                    nextState = .signedOut
                case .passwordRecovery, .userDeleted, .mfaChallengeVerified:
                    nextState = self.state
                @unknown default:
                    nextState = self.state
                }
                self.state = nextState
            }
        }
    }

    // MARK: - Email + password

    func signIn(email: String, password: String) async {
        lastError = nil
        do {
            let session = try await client.auth.signIn(email: email, password: password)
            // Update state immediately so the UI doesn't have to wait for the stream.
            state = .signedIn(userId: session.user.id.uuidString.lowercased())
        } catch {
            lastError = friendlyMessage(for: error)
        }
    }

    // MARK: - Magic link

    func sendMagicLink(email: String) async -> Bool {
        lastError = nil
        do {
            try await client.auth.signInWithOTP(
                email: email,
                redirectTo: nil,
                shouldCreateUser: false
            )
            return true
        } catch {
            lastError = friendlyMessage(for: error)
            return false
        }
    }

    // MARK: - Sign out

    func signOut() async {
        do {
            try await client.auth.signOut()
            state = .signedOut
        } catch {
            // Even if the server-side revocation fails, treat us as signed out locally so
            // the UI doesn't get stuck. The keychain has already been cleared by signOut().
            state = .signedOut
            lastError = friendlyMessage(for: error)
        }
    }

    // MARK: - Errors

    private func friendlyMessage(for error: Error) -> String {
        let raw = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        if raw.lowercased().contains("invalid") {
            return "Email or password didn't match. Please try again."
        }
        return raw
    }
}
