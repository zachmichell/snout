//
//  SupabaseClient.swift
//  Snout
//
//  Singleton wrapper around the supabase-swift client. Reads URL + anon key from AppConfig.
//  Session is persisted to Keychain by default — do not roll your own session store.
//

import Foundation
import Supabase

enum SupabaseClientProvider {
    static let shared: SupabaseClient = {
        SupabaseClient(
            supabaseURL: AppConfig.supabaseURL,
            supabaseKey: AppConfig.supabaseAnonKey
        )
    }()
}
