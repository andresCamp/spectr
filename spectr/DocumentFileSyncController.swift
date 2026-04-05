//
//  DocumentFileSyncController.swift
//  Spectr
//
//  Created by Codex on 3/20/26.
//

import AppKit
import Combine
import Foundation
import SwiftUI

@MainActor
final class DocumentFileSyncController: ObservableObject {
    struct Conflict: Identifiable {
        let id = UUID()
    }

    @Published private(set) var conflict: Conflict?

    private weak var appKitDocument: NSDocument?
    private var textBinding: Binding<String>?
    private var monitoredFileURL: URL?
    private var fileMonitor: PresentedTextFileMonitor?

    func disconnect() {
        fileMonitor?.invalidate()
        fileMonitor = nil
        monitoredFileURL = nil
        appKitDocument = nil
        textBinding = nil
        conflict = nil
    }

    func configure(
        window: NSWindow?,
        fileURL: URL?,
        text: Binding<String>
    ) {
        appKitDocument = window?.windowController?.document as? NSDocument
        textBinding = text

        let normalizedURL = fileURL?.standardizedFileURL
        guard monitoredFileURL != normalizedURL else { return }

        monitoredFileURL = normalizedURL
        conflict = nil
        fileMonitor?.invalidate()
        fileMonitor = nil

        guard let normalizedURL else { return }

        let fileMonitor = PresentedTextFileMonitor(url: normalizedURL) { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleFileMonitorEvent(event)
            }
        }

        self.fileMonitor = fileMonitor
        fileMonitor.start()
    }

    func reloadFromDisk() {
        conflict = nil
        revertDocument()
    }

    func keepLocalChanges() {
        conflict = nil
    }

    private func handleFileMonitorEvent(_ event: PresentedTextFileMonitor.Event) {
        switch event {
        case .changed:
            handlePresentedItemChange()
        case .moved(let fileURL):
            monitoredFileURL = fileURL.standardizedFileURL
        }
    }

    private func handlePresentedItemChange() {
        // If the user has unsaved local edits, show a conflict dialog
        // instead of silently reverting.
        if appKitDocument?.hasUnautosavedChanges == true {
            conflict = Conflict()
            return
        }

        // Let NSDocument handle all file coordination and bookkeeping.
        // The coordinator will detect the text change as external and animate it.
        revertDocument()
    }

    private func revertDocument() {
        guard let document = appKitDocument else { return }
        guard let fileURL = document.fileURL, let fileType = document.fileType else { return }

        do {
            try document.revert(toContentsOf: fileURL, ofType: fileType)
        } catch {
            // Revert failed — leave current content in place.
        }
    }
}

private final class PresentedTextFileMonitor: NSObject, NSFilePresenter, @unchecked Sendable {
    enum Event {
        case changed(URL)
        case moved(URL)
    }

    private let lock = NSLock()
    private var _presentedItemURL: URL?

    var presentedItemURL: URL? {
        get { lock.withLock { _presentedItemURL } }
        set { lock.withLock { _presentedItemURL = newValue } }
    }

    let presentedItemOperationQueue: OperationQueue

    private let onEvent: @Sendable (Event) -> Void
    private var isRegistered = false

    init(
        url: URL,
        onEvent: @escaping @Sendable (Event) -> Void
    ) {
        _presentedItemURL = url
        self.onEvent = onEvent
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        queue.qualityOfService = .userInitiated
        presentedItemOperationQueue = queue
        super.init()
    }

    func start() {
        guard !isRegistered else { return }
        isRegistered = true
        NSFileCoordinator.addFilePresenter(self)
    }

    @MainActor
    func invalidate() {
        guard isRegistered else { return }
        isRegistered = false
        NSFileCoordinator.removeFilePresenter(self)
    }

    func presentedItemDidChange() {
        guard let url = presentedItemURL else { return }
        onEvent(.changed(url))
    }

    func presentedItemDidMove(to newURL: URL) {
        presentedItemURL = newURL
        onEvent(.moved(newURL))
    }
}
