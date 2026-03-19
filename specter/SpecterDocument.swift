//
//  SpecterDocument.swift
//  Specter
//
//  Created by Andrés Campos on 3/18/26.
//

import SwiftUI
import UniformTypeIdentifiers

nonisolated struct SpecterDocument: FileDocument {
    var text: String

    init(text: String = "") {
        self.text = text
    }

    static var readableContentTypes: [UTType] {
        if let markdown = UTType(filenameExtension: "md") {
            return [markdown]
        }
        return [.plainText]
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents,
              let string = String(data: data, encoding: .utf8)
        else {
            throw CocoaError(.fileReadCorruptFile)
        }
        text = string
    }
    
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        let data = Data(text.utf8)
        return .init(regularFileWithContents: data)
    }
}
