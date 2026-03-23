//
//  SpectrApp.swift
//  Spectr
//
//  Created by Andrés Campos on 3/18/26.
//

import SwiftUI

@main
struct SpectrApp: App {
    var body: some Scene {
        DocumentGroup(newDocument: SpectrDocument()) { file in
            DocumentView(
                fileURL: file.fileURL,
                document: file.$document
            )
        }
        .windowToolbarStyle(.unifiedCompact)
        .commands {
            EditorTextSizeCommands()
        }
    }
}
