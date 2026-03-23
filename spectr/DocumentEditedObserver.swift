//
//  DocumentEditedObserver.swift
//  Spectr
//
//  Created by Andrés Campos on 3/20/26.
//

import AppKit
import Combine

@MainActor
final class DocumentEditedObserver: ObservableObject {
    @Published private(set) var isEdited = false

    private weak var window: NSWindow?
    private var observation: NSKeyValueObservation?

    func attach(to window: NSWindow?) {
        guard self.window !== window else { return }

        self.window = window
        observation?.invalidate()

        guard let window else {
            isEdited = false
            return
        }

        observation = window.observe(
            \.isDocumentEdited,
            options: [.initial, .new]
        ) { [weak self] window, _ in
            let edited = window.isDocumentEdited
            DispatchQueue.main.async { [weak self] in
                self?.isEdited = edited
            }
        }
    }

}
