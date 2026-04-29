//
//  FormatTests.swift
//  SnoutTests
//
//  Parity contract: src/lib/__tests__/format.test.ts (to be added — see PARITY_LOG).
//

import XCTest
@testable import Snout

final class FormatTests: XCTestCase {
    func test_speciesIcon() {
        XCTAssertEqual(Format.speciesIcon("dog"), "🐕")
        XCTAssertEqual(Format.speciesIcon("cat"), "🐈")
        XCTAssertEqual(Format.speciesIcon(nil), "🐾")
        XCTAssertEqual(Format.speciesIcon("rabbit"), "🐾")
    }

    func test_kgToLbs() {
        XCTAssertEqual(Format.kgToLbs(10), "22.0")
        XCTAssertEqual(Format.kgToLbs(0), "0.0")
        XCTAssertNil(Format.kgToLbs(nil))
    }

    func test_calcAge_youngerThanYear() {
        // Born 6 months ago
        let now = ISO8601DateFormatter().date(from: "2026-04-27T00:00:00Z")!
        XCTAssertEqual(Format.calcAge(dob: "2025-10-27", now: now), "6 months")
    }

    func test_calcAge_oneMonthIsSingular() {
        let now = ISO8601DateFormatter().date(from: "2026-04-27T00:00:00Z")!
        XCTAssertEqual(Format.calcAge(dob: "2026-03-27", now: now), "1 month")
    }

    func test_calcAge_yearAndMonths() {
        let now = ISO8601DateFormatter().date(from: "2026-04-27T00:00:00Z")!
        XCTAssertEqual(Format.calcAge(dob: "2024-10-27", now: now), "1 year 6 months")
    }

    func test_calcAge_exactYears() {
        let now = ISO8601DateFormatter().date(from: "2026-04-27T00:00:00Z")!
        XCTAssertEqual(Format.calcAge(dob: "2024-04-27", now: now), "2 years")
    }

    func test_calcAge_nilOrEmpty() {
        XCTAssertNil(Format.calcAge(dob: nil))
        XCTAssertNil(Format.calcAge(dob: ""))
    }

    func test_isExpired() {
        let now = ISO8601DateFormatter().date(from: "2026-04-27T00:00:00Z")!
        XCTAssertTrue(Format.isExpired("2026-01-01", now: now))
        XCTAssertFalse(Format.isExpired("2027-01-01", now: now))
        XCTAssertFalse(Format.isExpired(nil, now: now))
    }

    func test_isExpiringSoon() {
        let now = ISO8601DateFormatter().date(from: "2026-04-27T00:00:00Z")!
        XCTAssertTrue(Format.isExpiringSoon("2026-05-15", now: now))    // within 30 days
        XCTAssertFalse(Format.isExpiringSoon("2026-06-15", now: now))   // beyond 30 days
        XCTAssertFalse(Format.isExpiringSoon("2026-01-01", now: now))   // already past
        XCTAssertFalse(Format.isExpiringSoon(nil, now: now))
    }

    func test_formatVaccineType() {
        XCTAssertEqual(Format.formatVaccineType("rabies"), "Rabies")
        XCTAssertEqual(Format.formatVaccineType("dapp"), "DAPP")
        XCTAssertEqual(Format.formatVaccineType("custom"), "custom")
    }

    func test_formatDate_invalidReturnsDash() {
        XCTAssertEqual(Format.formatDate(nil), "—")
        XCTAssertEqual(Format.formatDate(""), "—")
    }
}
