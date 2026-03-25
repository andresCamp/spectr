//
//  SpectrApp.swift
//  Spectr
//
//  Created by Andrés Campos on 3/18/26.
//

import SwiftUI

@main
struct SpectrApp: App {
    @Environment(\.openWindow) private var openWindow

    var body: some Scene {
        DocumentGroup(newDocument: SpectrDocument()) { file in
            DocumentView(
                fileURL: file.fileURL,
                document: file.$document
            )
        }
        .windowToolbarStyle(.unifiedCompact(showsTitle: false))
        .commands {
            WelcomeCommands()
            QuickOpenCommands()
            EditorTextSizeCommands()
        }

        Window("Welcome to Spectr", id: "welcome") {
            WelcomeView()
        }
        .windowResizability(.contentSize)
        .windowStyle(.hiddenTitleBar)
        .defaultLaunchBehavior(.presented)
    }
}

struct WelcomeCommands: Commands {
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(after: .newItem) {
            Button("Welcome to Spectr") {
                openWindow(id: "welcome")
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])
        }
    }
}
