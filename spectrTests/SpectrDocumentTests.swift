//
//  SpectrDocumentTests.swift
//  spectrTests
//

import XCTest
import UniformTypeIdentifiers
@testable import Spectr

final class SpectrDocumentTests: XCTestCase {

    func testInitCreatesEmptyText() {
        let doc = SpectrDocument()
        XCTAssertEqual(doc.text, "")
    }

    func testInitWithTextPreservesValue() {
        let doc = SpectrDocument(text: "hello")
        XCTAssertEqual(doc.text, "hello")
    }

    func testReadFromValidUTF8Data() throws {
        let content = "# Title\n\nSome markdown."
        let data = Data(content.utf8)
        let file = FileWrapper(regularFileWithContents: data)
        let type = UTType.plainText

        let config = FileDocumentReadConfiguration(contentType: type, file: file)
        let doc = try SpectrDocument(configuration: config)

        XCTAssertEqual(doc.text, content)
    }

    func testReadFromInvalidDataThrows() {
        // Create data that is not valid UTF-8.
        let invalidData = Data([0xFF, 0xFE, 0x80, 0x81])
        let file = FileWrapper(regularFileWithContents: invalidData)
        let type = UTType.plainText

        let config = FileDocumentReadConfiguration(contentType: type, file: file)

        XCTAssertThrowsError(try SpectrDocument(configuration: config))
    }

    func testWriteProducesValidUTF8Data() throws {
        let doc = SpectrDocument(text: "Hello, world!")
        let type = UTType.plainText

        let config = FileDocumentWriteConfiguration(existingFile: nil, contentType: type)
        let wrapper = try doc.fileWrapper(configuration: config)

        let data = wrapper.regularFileContents
        XCTAssertNotNil(data)

        let decoded = String(data: data!, encoding: .utf8)
        XCTAssertEqual(decoded, "Hello, world!")
    }

    func testReadableContentTypesIncludesMarkdown() {
        let types = SpectrDocument.readableContentTypes
        let extensions = types.compactMap { $0.preferredFilenameExtension }
        XCTAssertTrue(extensions.contains("md"), "readableContentTypes should include .md")
    }
}
