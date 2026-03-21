//
//  EditorZoom.swift
//  Specter
//
//  Created by Codex on 3/19/26.
//

import SwiftUI
import WebKit

@MainActor
final class EditorZoomController {
    var onMagnificationChanged: ((CGFloat) -> Void)?

    private weak var scrollView: NSScrollView?
    private var magnificationObservation: NSKeyValueObservation?
    private var magnifyEndObserver: NSObjectProtocol?

    private let defaultMagnification: CGFloat = 1.0
    private let maximumMagnification: CGFloat = 3.0
    private let magnificationStep: CGFloat = 0.1
    private let snapToDefaultThreshold: CGFloat = 0.1
    private let activeZoomEpsilon: CGFloat = 0.001

    func attach(to scrollView: NSScrollView) {
        if self.scrollView !== scrollView {
            magnificationObservation = scrollView.observe(
                \.magnification,
                options: [.initial, .new]
            ) { [weak self] scrollView, _ in
                let scale = scrollView.magnification
                DispatchQueue.main.async { [weak self] in
                    self?.onMagnificationChanged?(scale)
                }
            }

            if let magnifyEndObserver {
                NotificationCenter.default.removeObserver(magnifyEndObserver)
            }

            magnifyEndObserver = NotificationCenter.default.addObserver(
                forName: NSScrollView.didEndLiveMagnifyNotification,
                object: scrollView,
                queue: .main
            ) { [weak self] _ in
                DispatchQueue.main.async { [weak self] in
                    self?.snapToDefaultIfNeeded(animated: true)
                }
            }
        }

        self.scrollView = scrollView
        scrollView.allowsMagnification = true
        scrollView.minMagnification = defaultMagnification
        scrollView.maxMagnification = maximumMagnification
        scrollView.usesPredominantAxisScrolling = false
    }

    func zoomIn() {
        setMagnification(currentMagnification + magnificationStep)
    }

    func zoomOut() {
        setMagnification(currentMagnification - magnificationStep)
    }

    func resetZoom() {
        setMagnification(defaultMagnification)
    }

    var isEffectivelyZoomed: Bool {
        currentMagnification > defaultMagnification + activeZoomEpsilon
    }

    private var currentMagnification: CGFloat {
        scrollView?.magnification ?? defaultMagnification
    }

    private func setMagnification(_ value: CGFloat) {
        guard let scrollView else { return }

        let clampedMagnification = min(
            maximumMagnification,
            max(defaultMagnification, value)
        )

        scrollView.setMagnification(
            clampedMagnification,
            centeredAt: centerPoint(in: scrollView)
        )
    }

    private func snapToDefaultIfNeeded(animated: Bool) {
        guard let scrollView else { return }
        guard isNearDefaultMagnification(scrollView.magnification) else { return }

        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.16
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                scrollView.animator().magnification = defaultMagnification
            }
        } else {
            scrollView.magnification = defaultMagnification
        }
    }

    private func isNearDefaultMagnification(_ scale: CGFloat) -> Bool {
        scale <= defaultMagnification + snapToDefaultThreshold
    }

    private func centerPoint(in scrollView: NSScrollView) -> CGPoint {
        let visibleRect = scrollView.documentVisibleRect
        return CGPoint(
            x: visibleRect.midX,
            y: visibleRect.midY
        )
    }

    deinit {
        if let magnifyEndObserver {
            NotificationCenter.default.removeObserver(magnifyEndObserver)
        }
    }
}

enum EditorTextScale {
    static let defaultValue: CGFloat = 1.0
    static let minimumValue: CGFloat = 11.0 / 15.0
    static let maximumValue: CGFloat = 2.0
    static let step: CGFloat = 1.0 / 15.0

    static func clamped(_ value: CGFloat) -> CGFloat {
        min(maximumValue, max(minimumValue, value))
    }
}

struct EditorTextSizeActions {
    let increase: () -> Void
    let decrease: () -> Void
    let reset: () -> Void
}

private struct EditorTextSizeActionsKey: FocusedValueKey {
    typealias Value = EditorTextSizeActions
}

extension FocusedValues {
    var editorTextSizeActions: EditorTextSizeActions? {
        get { self[EditorTextSizeActionsKey.self] }
        set { self[EditorTextSizeActionsKey.self] = newValue }
    }
}

struct EditorTextSizeCommands: Commands {
    @FocusedValue(\.editorTextSizeActions) private var editorTextSizeActions

    var body: some Commands {
        CommandGroup(after: .toolbar) {
            Divider()

            Button("Increase Text Size") {
                editorTextSizeActions?.increase()
            }
            .keyboardShortcut("+", modifiers: .command)
            .disabled(editorTextSizeActions == nil)

            Button("Decrease Text Size") {
                editorTextSizeActions?.decrease()
            }
            .keyboardShortcut("-", modifiers: .command)
            .disabled(editorTextSizeActions == nil)

            Button("Actual Text Size") {
                editorTextSizeActions?.reset()
            }
            .keyboardShortcut("0", modifiers: .command)
            .disabled(editorTextSizeActions == nil)
        }
    }
}
