//
//  SupabaseClient.swift
//  Snout
//
//  Singleton wrapper around the supabase-swift client. Reads URL + anon key from AppConfig.
//
//  Session storage:
//  - Release builds: the SDK's default `KeychainLocalStorage`. Encrypted at rest,
//    survives app updates, properly tied to the app's keychain access group.
//  - DEBUG builds: a UserDefaults-backed shim. The simulator + unsigned dev builds
//    can't write to the iOS Keychain (logs `NOT_CODESIGNED` errors), so the SDK's
//    default storage silently fails — sessions don't survive past a single PostgREST
//    request and every authenticated query falls back to anon. UserDefaults works
//    without code-signing and is fine for development. Once a paid Apple Developer
//    team is wired into project.yml the DEBUG branch becomes redundant, but it stays
//    in the source for parity across machines that may still be unsigned.
//

import Foundation
import Supabase

enum SupabaseClientProvider {
    static let shared: SupabaseClient = {
        SupabaseClient(
            supabaseURL: AppConfig.supabaseURL,
            supabaseKey: AppConfig.supabaseAnonKey,
            options: SupabaseClientOptions(
                auth: authOptions
            )
        )
    }()

    private static var authOptions: SupabaseClientOptions.AuthOptions {
        #if DEBUG
        print("[SupabaseClientProvider] DEBUG build — using UserDefaults-backed auth storage (Keychain bypass for unsigned builds)")
        return .init(
            storage: UserDefaultsAuthStorage(),
            emitLocalSessionAsInitialSession: true
        )
        #else
        return .init(
            emitLocalSessionAsInitialSession: true
        )
        #endif
    }
}

#if DEBUG
/// UserDefaults-backed `AuthLocalStorage` for unsigned dev builds. The SDK's default
/// `KeychainLocalStorage` requires a code-signed app — without an Apple Developer
/// team in `project.yml`, Keychain writes silently fail in the simulator (visible as
/// `NOT_CODESIGNED` log lines). UserDefaults sidesteps this entirely.
///
/// **Not for release.** Sessions stored this way are not encrypted at rest and the
/// values appear in the app's `Library/Preferences` plist. The whole struct compiles
/// out of release builds via `#if DEBUG`.
private struct UserDefaultsAuthStorage: AuthLocalStorage {
    private let defaults: UserDefaults = {
        // Use a dedicated suite so dev session blobs don't pollute the standard
        // UserDefaults that the rest of the app might use for preferences.
        UserDefaults(suiteName: "app.snout.ios.auth-debug") ?? .standard
    }()

    func store(key: String, value: Data) throws {
        defaults.set(value, forKey: key)
    }

    func retrieve(key: String) throws -> Data? {
        defaults.data(forKey: key)
    }

    func remove(key: String) throws {
        defaults.removeObject(forKey: key)
    }
}
#endif
