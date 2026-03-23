//
//  ContentView.swift
//  Spectr
//
//  Created by Andrés Campos on 3/18/26.
//

import SwiftUI

// Keep the template-era entrypoint available because Xcode's
// filesystem-synced project metadata can temporarily retain stale
// references to the old file during reloads.
struct ContentView: View {
    let fileURL: URL?
    @Binding var document: SpectrDocument

    var body: some View {
        DocumentView(
            fileURL: fileURL,
            document: $document
        )
    }
}
