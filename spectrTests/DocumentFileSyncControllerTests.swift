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
}
