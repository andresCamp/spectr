//
//  EditorZoomControllerTests.swift
//  spectrTests
//

import XCTest
@testable import Spectr

@MainActor
final class EditorZoomControllerTests: XCTestCase {

    // MARK: - EditorTextScale tests

    func testDefaultScaleIsOne() {
        XCTAssertEqual(EditorTextScale.defaultValue, 1.0)
    }

    func testClampedRespectsMinimum() {
        let result = EditorTextScale.clamped(0.0)
        XCTAssertEqual(result, EditorTextScale.minimumValue)
    }

    func testClampedRespectsMaximum() {
        let result = EditorTextScale.clamped(100.0)
        XCTAssertEqual(result, EditorTextScale.maximumValue)
    }

    func testClampedPassthroughForInRangeValue() {
        let value: CGFloat = 1.5
        let result = EditorTextScale.clamped(value)
        XCTAssertEqual(result, value)
    }

    func testStepIncrement() {
        let start = EditorTextScale.defaultValue
        let incremented = EditorTextScale.clamped(start + EditorTextScale.step)
        XCTAssertGreaterThan(incremented, start)
    }

    func testStepDecrement() {
        let start = EditorTextScale.defaultValue
        let decremented = EditorTextScale.clamped(start - EditorTextScale.step)
        XCTAssertLessThan(decremented, start)
    }

    func testResetValueEqualsDefault() {
        // After several increments, clamping the default should return 1.0.
        let reset = EditorTextScale.clamped(EditorTextScale.defaultValue)
        XCTAssertEqual(reset, 1.0)
    }

    // MARK: - EditorZoomController (no scroll view attached)

    func testIsEffectivelyZoomedIsFalseWithoutScrollView() {
        let controller = EditorZoomController()
        // Without an attached scroll view, currentMagnification falls back to
        // defaultMagnification (1.0), so the controller should not be "zoomed".
        XCTAssertFalse(controller.isEffectivelyZoomed)
    }

    func testZoomInDoesNotCrashWithoutScrollView() {
        let controller = EditorZoomController()
        // Should be a no-op, not a crash.
        controller.zoomIn()
    }

    func testZoomOutDoesNotCrashWithoutScrollView() {
        let controller = EditorZoomController()
        controller.zoomOut()
    }

    func testResetZoomDoesNotCrashWithoutScrollView() {
        let controller = EditorZoomController()
        controller.resetZoom()
    }
}
