//
//  AppConfig.swift
//  Snout
//
//  Loads SUPABASE_URL and SUPABASE_ANON_KEY from Config.plist.
//  Config.plist is gitignored; Config.example.plist is committed as a template.
//

import Foundation

enum AppConfig {
    enum ConfigError: Error, LocalizedError {
        case missingFile
        case missingKey(String)

        var errorDescription: String? {
            switch self {
            case .missingFile:
                return "Config.plist is missing from the bundle. Copy Config.example.plist and fill it in."
            case .missingKey(let key):
                return "Config.plist is missing required key: \(key)"
            }
        }
    }

    private static let plist: [String: Any] = {
        guard
            let url = Bundle.main.url(forResource: "Config", withExtension: "plist"),
            let data = try? Data(contentsOf: url),
            let dict = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        else {
            assertionFailure("Config.plist missing or unreadable. See README.")
            return [:]
        }
        return dict
    }()

    static var supabaseURL: URL {
        guard
            let raw = plist["SUPABASE_URL"] as? String,
            let url = URL(string: raw)
        else {
            preconditionFailure("SUPABASE_URL missing from Config.plist")
        }
        return url
    }

    static var supabaseAnonKey: String {
        guard let key = plist["SUPABASE_ANON_KEY"] as? String, !key.isEmpty else {
            preconditionFailure("SUPABASE_ANON_KEY missing from Config.plist")
        }
        return key
    }
}
