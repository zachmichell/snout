//
//  SnoutUITestsLaunchTests.swift
//  SnoutUITests
//
//  Smoke test that the app launches without crashing. Real UI flows come later.
//

import XCTest

final class SnoutUITestsLaunchTests: XCTestCase {
    override class var runsForEachTargetApplicationUIConfiguration: Bool { true }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLaunch() throws {
        let app = XCUIApplication()
        app.launch()
        // Just verifying no crash on launch. The auth gate may be on-screen, which is fine.
    }
}
