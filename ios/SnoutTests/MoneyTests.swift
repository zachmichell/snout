//
//  MoneyTests.swift
//  SnoutTests
//
//  Parity contract: src/lib/__tests__/money.test.ts (to be added — see PARITY_LOG).
//

import XCTest
@testable import Snout

final class MoneyTests: XCTestCase {
    func test_formatCents_basic() {
        XCTAssertEqual(Money.formatCents(5250), "$52.50 CAD")
        XCTAssertEqual(Money.formatCents(0), "$0.00 CAD")
        XCTAssertEqual(Money.formatCents(nil), "$0.00 CAD")
        XCTAssertEqual(Money.formatCents(99), "$0.99 CAD")
    }

    func test_formatCents_currencyOverride() {
        XCTAssertEqual(Money.formatCents(5250, currency: "USD"), "$52.50 USD")
    }

    func test_formatCentsShort() {
        XCTAssertEqual(Money.formatCentsShort(5250), "$52.50")
        XCTAssertEqual(Money.formatCentsShort(nil), "$0.00")
        XCTAssertEqual(Money.formatCentsShort(0), "$0.00")
    }

    func test_parseDollarsToCents_valid() {
        XCTAssertEqual(Money.parseDollarsToCents("52.50"), 5250)
        XCTAssertEqual(Money.parseDollarsToCents("0"), 0)
        XCTAssertEqual(Money.parseDollarsToCents("100"), 10000)
        XCTAssertEqual(Money.parseDollarsToCents("  12.34  "), 1234)
    }

    func test_parseDollarsToCents_invalid() {
        XCTAssertNil(Money.parseDollarsToCents(""))
        XCTAssertNil(Money.parseDollarsToCents("   "))
        XCTAssertNil(Money.parseDollarsToCents("abc"))
        XCTAssertNil(Money.parseDollarsToCents("-5"))
    }

    func test_parseDollarsToCents_rounds() {
        XCTAssertEqual(Money.parseDollarsToCents("0.005"), 1)        // rounds .5 cents up
        XCTAssertEqual(Money.parseDollarsToCents("0.004"), 0)
    }

    func test_centsToDollarString() {
        XCTAssertEqual(Money.centsToDollarString(5250), "52.50")
        XCTAssertEqual(Money.centsToDollarString(nil), "")
        XCTAssertEqual(Money.centsToDollarString(0), "0.00")
    }

    func test_formatDurationType() {
        XCTAssertEqual(Money.formatDurationType("hourly"), "Hourly")
        XCTAssertEqual(Money.formatDurationType("half_day"), "Half Day")
        XCTAssertEqual(Money.formatDurationType("full_day"), "Full Day")
        XCTAssertEqual(Money.formatDurationType("overnight"), "Overnight")
        XCTAssertEqual(Money.formatDurationType("multi_night"), "Multi-Night")
        XCTAssertEqual(Money.formatDurationType("zzz"), "zzz")
    }

    func test_formatModule() {
        XCTAssertEqual(Money.formatModule("daycare"), "Daycare")
        XCTAssertEqual(Money.formatModule("retail"), "Retail")
        XCTAssertEqual(Money.formatModule("custom"), "custom")
    }

    func test_formatReservationStatus() {
        XCTAssertEqual(Money.formatReservationStatus("requested"), "Requested")
        XCTAssertEqual(Money.formatReservationStatus("checked_in"), "Checked In")
        XCTAssertEqual(Money.formatReservationStatus("no_show"), "No Show")
        XCTAssertEqual(Money.formatReservationStatus("xyz"), "xyz")
    }
}
