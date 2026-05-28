//
//  StaffRole.swift
//  Snout Staff
//
//  Swift mirror of the web app's role tiers (apps/web/src/lib/permissions.ts).
//  The app gates "lanes" (home tabs) by capability per role rather than
//  mirroring all ~40 web permission strings — the lane set is the subset the
//  staff app actually surfaces, kept consistent with the web tiers and the
//  is_org_staff RLS that backs them.
//

import Foundation

enum StaffRole: String, Codable, CaseIterable {
    case owner, admin, manager, supervisor, staff, groomer, trainer, customer

    /// Anyone who isn't a customer is staff (mirrors is_org_staff).
    var isStaff: Bool { self != .customer }

    var label: String {
        switch self {
        case .owner:      return "Owner"
        case .admin:      return "Admin"
        case .manager:    return "Manager"
        case .supervisor: return "Supervisor"
        case .staff:      return "Staff"
        case .groomer:    return "Groomer"
        case .trainer:    return "Trainer"
        case .customer:   return "Customer"
        }
    }
}

/// A "lane" the staff app can surface. Each maps to a home tab / section.
/// Phase-2 lanes (pos, analytics, shifts) are declared but not yet built.
enum StaffCapability: String, CaseIterable {
    case dashboard        // business KPIs / oversight
    case schedule         // today's pack + check-in/out
    case grooming         // groomer appointment day
    case training         // trainer class day
    case reportCards      // report cards + care logs
    case messaging        // client messaging
    case petsOwners       // pet + owner lookup
    // Phase 2:
    case pos
    case analytics
    case shifts
}

enum StaffPermissions {
    /// Capabilities available to each role. Derived from the web PERMISSIONS_BY_ROLE
    /// tiers: front-line staff get floor ops; supervisor adds grooming oversight;
    /// manager/admin/owner get everything incl. the dashboard; groomer/trainer are
    /// the specialized single-lane roles (+ messaging).
    static func capabilities(for role: StaffRole) -> [StaffCapability] {
        switch role {
        case .owner, .admin, .manager:
            return [.dashboard, .schedule, .grooming, .training, .reportCards, .messaging, .petsOwners]
        case .supervisor:
            return [.schedule, .grooming, .training, .reportCards, .messaging, .petsOwners]
        case .staff:
            return [.schedule, .reportCards, .messaging, .petsOwners]
        case .groomer:
            return [.grooming, .messaging]
        case .trainer:
            return [.training, .messaging]
        case .customer:
            return []
        }
    }

    static func can(_ role: StaffRole, _ capability: StaffCapability) -> Bool {
        capabilities(for: role).contains(capability)
    }

    /// The lane a role lands on by default (their home).
    static func defaultHome(for role: StaffRole) -> StaffCapability {
        switch role {
        case .owner, .admin, .manager: return .dashboard
        case .supervisor, .staff:      return .schedule
        case .groomer:                 return .grooming
        case .trainer:                 return .training
        case .customer:                return .schedule
        }
    }
}
