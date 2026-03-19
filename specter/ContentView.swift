//
//  ContentView.swift
//  Specter
//
//  Created by Andrés Campos on 3/18/26.
//

import SwiftUI

struct ContentView: View {
    @Binding var document: SpecterDocument

    var body: some View {
        TextEditor(text: $document.text)
    }
}

#Preview {
    ContentView(document: .constant(SpecterDocument()))
}
