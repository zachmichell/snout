//
//  StorageDownloadTests.swift
//  SnoutTests
//
//  Parity contract: src/lib/__tests__/storage-download.test.ts (to be added — see PARITY_LOG).
//  Both implementations must satisfy the same inputs and outputs.
//

import XCTest
@testable import Snout

final class StorageDownloadTests: XCTestCase {
    // MARK: - slugifyForFilename

    func test_slugify_emptyOrNil_returnsFile() {
        XCTAssertEqual(StorageDownload.slugifyForFilename(nil), "file")
        XCTAssertEqual(StorageDownload.slugifyForFilename(""), "file")
        XCTAssertEqual(StorageDownload.slugifyForFilename("   "), "file")
    }

    func test_slugify_lowercases() {
        XCTAssertEqual(StorageDownload.slugifyForFilename("Bear"), "bear")
        XCTAssertEqual(StorageDownload.slugifyForFilename("REPORT-CARD"), "report-card")
    }

    func test_slugify_replacesUnsafeChars() {
        XCTAssertEqual(StorageDownload.slugifyForFilename("Bear & Lola"), "bear-lola")
        XCTAssertEqual(StorageDownload.slugifyForFilename("My File!.jpg"), "my-file.jpg")
    }

    func test_slugify_collapsesRunsOfUnsafeIntoSingleHyphen() {
        XCTAssertEqual(StorageDownload.slugifyForFilename("a   b"), "a-b")
        XCTAssertEqual(StorageDownload.slugifyForFilename("a !! b"), "a-b")
    }

    func test_slugify_trimsLeadingAndTrailingHyphens() {
        XCTAssertEqual(StorageDownload.slugifyForFilename("--bear--"), "bear")
        XCTAssertEqual(StorageDownload.slugifyForFilename("!!!hi!!!"), "hi")
    }

    func test_slugify_keepsAllowedChars() {
        XCTAssertEqual(StorageDownload.slugifyForFilename("a-b_c.d"), "a-b_c.d")
        XCTAssertEqual(StorageDownload.slugifyForFilename("file.2024-01-15"), "file.2024-01-15")
    }

    func test_slugify_allUnsafeChars_returnsFile() {
        XCTAssertEqual(StorageDownload.slugifyForFilename("!!!"), "file")
        XCTAssertEqual(StorageDownload.slugifyForFilename("   /// "), "file")
    }

    // MARK: - withDownloadFilename

    func test_withDownloadFilename_addsParam() {
        let url = "https://example.supabase.co/storage/v1/object/sign/abc?token=xyz"
        let result = StorageDownload.withDownloadFilename(signedURL: url, filename: "bear.jpg")
        XCTAssertTrue(result.contains("token=xyz"))
        XCTAssertTrue(result.contains("download=bear.jpg"))
    }

    func test_withDownloadFilename_replacesExistingDownloadParam() {
        let url = "https://example.supabase.co/storage/v1/object/sign/abc?token=xyz&download=old.jpg"
        let result = StorageDownload.withDownloadFilename(signedURL: url, filename: "new.jpg")
        XCTAssertTrue(result.contains("download=new.jpg"))
        XCTAssertFalse(result.contains("download=old.jpg"))
    }

    func test_withDownloadFilename_relativePathFallback() {
        let result = StorageDownload.withDownloadFilename(signedURL: "/foo/bar", filename: "x.jpg")
        XCTAssertTrue(result.hasSuffix("download=x.jpg"))
    }

    // MARK: - extensionFromPath

    func test_extensionFromPath_basic() {
        XCTAssertEqual(StorageDownload.extensionFromPath("photo.jpg"), "jpg")
        XCTAssertEqual(StorageDownload.extensionFromPath("Photo.JPG"), "jpg")
        XCTAssertEqual(StorageDownload.extensionFromPath("foo/bar/photo.png"), "png")
    }

    func test_extensionFromPath_noDot_returnsFallback() {
        XCTAssertEqual(StorageDownload.extensionFromPath("photo"), "jpg")
        XCTAssertEqual(StorageDownload.extensionFromPath("photo", fallback: "pdf"), "pdf")
    }

    func test_extensionFromPath_nilOrEmpty_returnsFallback() {
        XCTAssertEqual(StorageDownload.extensionFromPath(nil), "jpg")
        XCTAssertEqual(StorageDownload.extensionFromPath(""), "jpg")
    }

    func test_extensionFromPath_stripsQueryAndFragment() {
        XCTAssertEqual(StorageDownload.extensionFromPath("photo.png?token=xyz"), "png")
        XCTAssertEqual(StorageDownload.extensionFromPath("photo.png#frag"), "png")
    }

    func test_extensionFromPath_dotAtEnd_returnsFallback() {
        XCTAssertEqual(StorageDownload.extensionFromPath("photo."), "jpg")
    }
}
