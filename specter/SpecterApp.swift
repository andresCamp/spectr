//
//  SpecterApp.swift
//  Specter
//
//  Created by Andrés Campos on 3/18/26.
//

import SwiftUI

@main
struct SpecterApp: App {
    var body: some Scene {
        DocumentGroup(newDocument: SpecterDocument()) { file in
            DocumentView(document: file.$document)
        }
    }
}
