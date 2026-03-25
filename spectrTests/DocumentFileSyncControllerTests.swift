//
//  DocumentFileSyncControllerTests.swift
//  spectrTests
//

import XCTest
import SwiftUI
@testable import Spectr

@MainActor
final class DocumentFileSyncControllerTests: XCTestCase {

    func testDisconnectClearsConflict() {
        let controller = DocumentFileSyncController()
        controller.disconnect()
        XCTAssertNil(controller.conflict)
    }

    func testConfigureWithNilURLDoesNotCrash() {
        let controller = DocumentFileSyncController()
        var text = ""
        let binding = Binding<String>(get: { text }, set: { text = $0 })
        // Passing nil window and nil fileURL should be a safe no-op.
        controller.configure(window: nil, fileURL: nil, text: binding)
        XCTAssertNil(controller.conflict)
    }

    func testKeepLocalChangesClearsConflict() {
        let controller = DocumentFileSyncController()
        controller.keepLocalChanges()
        XCTAssertNil(controller.conflict)
    }

    func testDisconnectIsIdempotent() {
        let controller = DocumentFileSyncController()
        controller.disconnect()
        controller.disconnect()
        XCTAssertNil(controller.conflict)
    }

    // MARK: - readText integration (via temp file)

    func testReadTextReadsValidUTF8File() throws {
        let tempDir = FileManager.default.temporaryDirectory
        let fileURL = tempDir.appendingPathComponent(UUID().uuidString + ".md")
        let content = "# Test\nHello, world!"

        try Data(content.utf8).write(to: fileURL)
        addTeardownBlock { try? FileManager.default.removeItem(at: fileURL) }

        // readText is private, so we test it indirectly: configure a controller
        // with a temp file and verify it picks up the content via reloadFromDisk
        // falling back to applyFileContentsDirectly (since there's no NSDocument).
        let controller = DocumentFileSyncController()
        var text = ""
        let binding = Binding<String>(get: { text }, set: { text = $0 })

        controller.configure(window: nil, fileURL: fileURL, text: binding)
        controller.reloadFromDisk()

        XCTAssertEqual(text, content)
    }

    func testReloadFromDiskWithMissingFileKeepsExistingText() {
        let missingURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString + ".md")

        let controller = DocumentFileSyncController()
        var text = "original"
        let binding = Binding<String>(get: { text }, set: { text = $0 })

        controller.configure(window: nil, fileURL: missingURL, text: binding)
        controller.reloadFromDisk()

        // The file doesn't exist so readText should fail; text stays unchanged.
        XCTAssertEqual(text, "original")
    }
}
