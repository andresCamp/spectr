//
//  WindowPinController.swift
//  Spectr
//
//  Created by Codex on 3/20/26.
//

import AppKit
import SwiftUI

@MainActor
final class WindowPinController {
    private weak var window: NSWindow?
    private var baselineLevel: NSWindow.Level?
    private var baselineCollectionBehavior: NSWindow.CollectionBehavior?
    private var isPinned = false

    private let pinnedCollectionBehavior: NSWindow.CollectionBehavior = [
        .canJoinAllSpaces,
        .fullScreenAuxiliary,
    ]

    func attach(to window: NSWindow?) {
        guard self.window !== window else {
            applyPinnedState()
            return
        }

        restoreAttachedWindow()

        self.window = window
        baselineLevel = window?.level
        baselineCollectionBehavior = window?.collectionBehavior

        applyPinnedState()
    }

    func setPinned(_ pinned: Bool) {
        isPinned = pinned
        applyPinnedState()
    }

    private func applyPinnedState() {
        guard let window else { return }
        guard let baselineLevel, let baselineCollectionBehavior else { return }

        if isPinned {
            window.level = .floating
            window.collectionBehavior = baselineCollectionBehavior.union(pinnedCollectionBehavior)
        } else {
            window.level = baselineLevel
            window.collectionBehavior = baselineCollectionBehavior
        }
    }

    private func restoreAttachedWindow() {
        guard let window else {
            clearBaseline()
            return
        }

        if let baselineLevel, let baselineCollectionBehavior {
            window.level = baselineLevel
            window.collectionBehavior = baselineCollectionBehavior
        }

        clearBaseline()
    }

    private func clearBaseline() {
        baselineLevel = nil
        baselineCollectionBehavior = nil
        window = nil
    }
}

struct WindowAccessorView: NSViewRepresentable {
    let onWindowChange: (NSWindow?) -> Void

    func makeNSView(context: Context) -> WindowObservationView {
        let view = WindowObservationView()
        view.onWindowChange = onWindowChange
        return view
    }

    func updateNSView(_ nsView: WindowObservationView, context: Context) {
        nsView.onWindowChange = onWindowChange
        nsView.reportCurrentWindow()
    }
}

final class WindowObservationView: NSView {
    var onWindowChange: ((NSWindow?) -> Void)?

    private weak var reportedWindow: NSWindow?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        report(window)
    }

    override func viewWillMove(toWindow newWindow: NSWindow?) {
        super.viewWillMove(toWindow: newWindow)

        if newWindow == nil {
            report(nil)
        }
    }

    override func viewDidMoveToSuperview() {
        super.viewDidMoveToSuperview()

        DispatchQueue.main.async { [weak self] in
            self?.report(self?.window)
        }
    }

    func reportCurrentWindow() {
        report(window)
    }

    private func report(_ window: NSWindow?) {
        guard reportedWindow !== window else { return }

        reportedWindow = window
        onWindowChange?(window)
    }
}
