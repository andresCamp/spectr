# Specter Phase 1 — Implementation Spec

**Existing Markdown Surface: Technical Architecture & Implementation Details**

---

## Phase 1 Boundary

Phase 1 is intentionally narrow:

- Open existing `.md` files in Specter
- View them in raw mode
- View them in rendered mode
- Make light edits in raw mode
- Save through the normal document lifecycle

Everything else is deferred:

- Custom Cmd+N launcher
- Fixed `~/Documents/Specter/` workflow
- Formatting bar
- `NSTextView` bridge
- Float-on-top
- Custom chrome gradients
- Focus/unfocus fade
- Custom markdown renderer

This scope is deliberate. The goal is to ship a stable daily-driver document surface first, then iterate.

---

## Architecture Overview

### App Structure

Use `DocumentGroup` as the only scene. It provides the document lifecycle, system open/save commands, recent files integration, and multiwindow behavior.

```swift
@main
struct SpecterApp: App {
    var body: some Scene {
        DocumentGroup(newDocument: SpecterDocument()) { file in
            DocumentView(document: file.$document)
        }
    }
}
```

`DocumentGroup(newDocument:)` is still the right choice even though Phase 1 is focused on existing files. It keeps the app editable and gives us the correct save lifecycle for raw-mode edits. Phase 1 simply does not customize the new-document experience yet.

### Document Model Architecture

```text
SpecterDocument (FileDocument, value type)
  └── text: String
```

The document remains a plain value type. SwiftUI and the document system own file reading, writing, dirty tracking, and save behavior.

### View Hierarchy

```text
DocumentView
  ├── content
  │   ├── RawModeView
  │   └── RenderedModeView
  └── toolbar
      └── mode toggle
```

Phase 1 should prefer standard macOS structure over custom chrome. The toggle can live in the default toolbar instead of building a custom overlay system immediately.

---

## Document Model

### FileDocument Conformance

```swift
import UniformTypeIdentifiers

nonisolated struct SpecterDocument: FileDocument {
    var text: String

    init(text: String = "") {
        self.text = text
    }

    static let readableContentTypes: [UTType] = [.markdown]

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
        return FileWrapper(regularFileWithContents: data)
    }
}
```

### UTType Registration

Register Markdown in `Info.plist` using the system type:

```xml
<key>CFBundleDocumentTypes</key>
<array>
    <dict>
        <key>CFBundleTypeRole</key>
        <string>Editor</string>
        <key>LSItemContentTypes</key>
        <array>
            <string>net.daringfireball.markdown</string>
        </array>
    </dict>
</array>
```

Remove the Xcode template's placeholder imported type.

### State Flow

```text
File on disk
  → DocumentGroup opens SpecterDocument
    → document.text populated
      → DocumentView receives Binding<SpecterDocument>
        → Raw mode reads/writes document.text
          → SwiftUI marks the document dirty
            → fileWrapper(configuration:) writes on save
```

Nothing custom is needed here. This is exactly the lifecycle Phase 1 should lean on.

---

## Raw Mode

### Core Component

Use plain SwiftUI `TextEditor`.

```swift
struct RawModeView: View {
    @Binding var text: String

    var body: some View {
        TextEditor(text: $text)
            .font(.system(.body, design: .monospaced))
    }
}
```

### Rationale

Phase 1 does not need selection-aware formatting insertion, so there is no reason to pay the complexity cost of an `NSTextView` bridge yet. `TextEditor` is the right tradeoff here:

- native
- simple
- fully adequate for light edits
- already compatible with the `FileDocument` binding

### Styling Guidance

- Use the system monospaced body font
- Keep padding restrained
- Avoid custom editor behavior in Phase 1

If editor limitations become painful later, that is the point to introduce the AppKit bridge in Phase 2.

---

## Rendered Mode

### Core Component

Use `MarkdownView` for Phase 1 rendering.

Repository: [LiYanan2004/MarkdownView](https://github.com/LiYanan2004/MarkdownView)

The README's Swift Package Manager instructions currently show:

```swift
.package(url: "https://github.com/LiYanan2004/MarkdownView.git", .branch("main"))
```

and target usage:

```swift
.target(name: "MyTarget", dependencies: ["MarkdownView"])
```

The README also lists these transitive dependencies:

- `apple/swift-markdown`
- `raspu/Highlightr`
- `colinc86/LaTeXSwiftUI`

For the Xcode app target, add the package through Xcode's package UI using the repository URL. The branch-based manifest snippet is still useful for documentation and future package-based setups.

### Why MarkdownView in Phase 1

This is the right pragmatic choice for the narrowed phase:

- much better markdown fidelity than native `AttributedString` rendering
- still SwiftUI-based
- faster to ship than designing a custom renderer now
- easy to replace later if Specter needs a more opinionated renderer

### Rendered View Structure

The README example shows the view being initialized as `MarkdownView(markdownText)`. Use that API shape in the Phase 1 implementation notes.

```swift
import MarkdownView
import SwiftUI

struct RenderedModeView: View {
    let text: String

    var body: some View {
        ScrollView {
            MarkdownView(text)
                .padding(.horizontal, 32)
                .padding(.vertical, 24)
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity)
        }
    }
}
```

### Styling Goals

Even with a third-party renderer, the presentation should feel restrained:

- SF Pro body typography
- generous line spacing
- centered readable width
- no web-view feel
- calm spacing around headings, lists, and code blocks

Do the minimum amount of styling needed to make real specs comfortable to read.

---

## Mode Toggle

### State

Keep the view-local state simple:

```swift
struct DocumentView: View {
    @Binding var document: SpecterDocument
    @State private var viewMode: ViewMode = .rendered

    enum ViewMode {
        case raw
        case rendered
    }

    var body: some View {
        Group {
            switch viewMode {
            case .raw:
                RawModeView(text: $document.text)
            case .rendered:
                RenderedModeView(text: document.text)
            }
        }
    }
}
```

### Toolbar Placement

Put the toggle in the standard toolbar for Phase 1.

```swift
.toolbar {
    Button {
        viewMode = (viewMode == .raw) ? .rendered : .raw
    } label: {
        Image(systemName: viewMode == .raw ? "doc.plaintext" : "doc.richtext")
    }
    .help(viewMode == .raw ? "Switch to Rendered" : "Switch to Raw")
}
```

This avoids premature custom chrome work while still giving the user an always-available switch.

### Behavior

- instant switch
- no transition animation required
- content preserved across modes because both views read the same document state

---

## Window Management

### Phase 1 Approach

Stay with standard document window behavior:

- default title bar
- default toolbar
- default focus behavior
- no `NSWindow` bridge

This is the cleanest Phase 1 path. It reduces the implementation surface dramatically and keeps the app aligned with macOS conventions while the core viewing/editing flow is proven.

### Multiwindow

Multiple documents should work automatically through `DocumentGroup`. No custom coordination is required.

### New Documents

Phase 1 does not define a productized new-document flow. The app may still expose the system document commands because `DocumentGroup(newDocument:)` is in use, but custom launcher behavior is explicitly deferred.

---

## File Access

Phase 1 focuses on existing files and the standard document lifecycle:

- open existing `.md` files from Finder or File > Open
- edit in raw mode
- save via the normal document commands

Do not implement:

- fixed writes to `~/Documents/Specter/`
- directory creation logic
- security-scoped bookmark storage

Those belong in a later phase if the product still wants an opinionated file-home workflow.

---

## Appearance

### Color Scheme

Follow the system appearance automatically.

### Fonts

| Context | Font |
|---|---|
| Raw mode | system monospaced body |
| Rendered mode | system proportional body |
| Toolbar | standard system toolbar styling |

### Visual Standard

Phase 1 should feel native and understated, not styled to death. Prefer the system defaults unless there is a strong readability reason to change them.

---

## Implementation Sequence

### Step 1: Document Model + File Associations

**What:** Replace the template UTType with `UTType.markdown` and verify `.md` file open/save behavior.

**Files:** `SpecterDocument.swift`, `Info.plist`

**Verification:** Open a markdown file, edit it, save, reopen it.

### Step 2: Raw Mode

**What:** Keep `TextEditor` as the raw editor and apply monospaced styling.

**Files:** `ContentView.swift` or renamed `DocumentView.swift`

**Verification:** Edit text, select text, copy/paste, undo, and save successfully.

### Step 3: Rendered Mode

**What:** Add `MarkdownView` and build `RenderedModeView`.

**Files:** `RenderedModeView.swift`, Xcode package dependency settings

**Verification:** Open real spec docs with headings, lists, links, tables, and code blocks. Confirm rendering fidelity is materially better than the native `AttributedString` version.

### Step 4: Mode Toggle

**What:** Add the raw/rendered toggle in the toolbar.

**Files:** `DocumentView.swift`

**Verification:** Toggle instantly between modes without losing document state.

### Step 5: Polish Pass

**What:** Tune spacing, typography, and toolbar copy. Verify light mode and dark mode. Check multiple document windows.

**Verification:** The app feels calm, readable, and stable for day-to-day spec reading and light editing.

---

## Technical Risks Summary

| Risk | Severity | Mitigation |
|---|---|---|
| MarkdownView integration | Low | Use the repo's documented SPM setup and keep the initial styling layer thin. |
| Over-styling rendered mode | Medium | Start from defaults and tune only for readability. |
| Phase creep | High | Keep launcher, formatting bar, chrome system, and custom renderer out of Phase 1. |

