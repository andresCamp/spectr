# Specter Phase 1 — Implementation Spec (Rendered-First)

**Editable Rendered Markdown for `.md` Files**

---

## Intent

This spec defines a different Phase 1 paradigm from the raw-editor-first approach:

- Opening a `.md` file should land in **rendered mode**
- Rendered mode is the **primary surface**
- Rendered mode must be **editable**
- Raw/source mode remains available as a secondary escape hatch
- Saving writes the current rendered edits back into the original markdown file

The target experience is: **Raycast Notes, but for real markdown files on disk**.

---

## Core Principle

The editable rendered view is **not** a preview.

It is the **primary editor** for the document.

Markdown remains the persisted file format, but the rendered editor is backed by a richer in-memory model:

1. Read markdown from disk
2. Parse it into a structured model
3. Build a native editable rendered surface from that model
4. Let the user edit the rendered surface directly
5. Persist those edits into the structured model
6. Serialize the model back into markdown
7. Save the markdown file

---

## System Diagram

```text
.md file on disk
  → SpecterDocument.text
    → MarkdownParser
      → MarkdownDocumentModel
        → Native rich editor state
          → Native editable rendered surface
             ↑          │
             │          │ user edits
             │          ↓
             └──── semantic edit operations
      MarkdownDocumentModel
        → MarkdownSerializer
          → synchronized markdown string
            → SpecterDocument.text
              → Cmd+S writes file to disk

Raw/source mode:
SpecterDocument.text
  ↔ RawSourceView
  ↔ MarkdownParser
  ↔ MarkdownDocumentModel
```

---

## Architecture Overview

### Persistence Layer

`SpecterDocument` remains the persisted `FileDocument` type:

```swift
nonisolated struct SpecterDocument: FileDocument {
    var text: String
}
```

This is still the disk representation. The file format on disk stays plain markdown.

### Editing Layer

The live editing engine should move into a reference-type session object:

```swift
@MainActor
final class DocumentSession: ObservableObject {
    @Published var viewMode: ViewMode = .rendered
    @Published var sourceMarkdown: String
    @Published var model: MarkdownDocumentModel

    var richEditorState: RichEditorState
    var hasPendingSerialization = false
}
```

This session is the in-memory editing authority for a single window.

### Editing Truth

The structured model is the editing truth.

That means:

- the primary rendered editor does **not** edit markdown syntax directly
- the primary rendered editor does **not** reveal markdown tokens inline
- markdown is regenerated from the model for persistence
- raw mode is the only place where exact markdown syntax is shown

### Why a Session Object

The document file on disk is markdown text.

The rendered editor, however, cannot edit that markdown string directly in any robust way. It needs:

- parsed structure
- block boundaries
- inline formatting spans
- selection state
- edit operations with semantic meaning

So the correct split is:

- `SpecterDocument.text` for persistence
- `DocumentSession` for editing behavior

---

## Data Model

### MarkdownDocumentModel

The rendered editor should not be backed by raw text. It should be backed by a structured document model, roughly:

```text
MarkdownDocumentModel
  ├── metadata
  ├── blocks[]
  │   ├── paragraph
  │   ├── heading(level)
  │   ├── unorderedList(items)
  │   ├── orderedList(items)
  │   ├── taskList(items)
  │   ├── blockquote(blocks)
  │   ├── codeBlock(language, text)
  │   ├── thematicBreak
  │   └── opaqueRawBlock(rawMarkdown)
  └── inline spans
      ├── text
      ├── emphasis
      ├── strong
      ├── inlineCode
      ├── link
      └── hardBreak
```

### Supported Subset for Editable Rendered Mode

Start with a constrained markdown subset that can round-trip reliably in the primary rendered editor:

- paragraphs
- headings
- unordered lists
- ordered lists
- task lists
- block quotes
- fenced code blocks
- bold
- italic
- inline code
- links
- line breaks

### Opaque / Fallback Nodes

For unsupported or risky constructs, preserve them as opaque raw blocks:

- tables
- HTML blocks
- footnotes
- nested edge cases that the editor cannot safely round-trip yet
- frontmatter, if not explicitly modeled

Rendered mode can display these read-only or minimally rendered, but editing them should route the user to raw mode for safety.

This is the critical strategy that prevents silent data corruption.

---

## Parsing and Serialization

### Parser

Use a markdown parser to build the structured model from `SpecterDocument.text`.

Recommended path:

- use Apple's `swift-markdown` package or another AST-capable parser
- map parser output into Specter's own `MarkdownDocumentModel`

Do **not** use `MarkdownView` as the primary foundation for this paradigm. It is a renderer, while this system needs a real editor model with markdown import/export.

### Serializer

The serializer converts `MarkdownDocumentModel` back into markdown text.

The serializer must:

- emit stable markdown
- preserve supported structures semantically
- preserve opaque raw blocks byte-for-byte where possible
- avoid rewriting the whole document unnecessarily if that creates churn

Exact whitespace preservation is not required in v1.
Semantic preservation is required.

---

## Primary Editor

### Core Requirement

The primary rendered editor must feel native and editable, not like a preview overlaid on hidden source text.

### Recommended Implementation

Use a native editable attributed text surface hosted from SwiftUI:

- SwiftUI shell for app structure
- AppKit-backed editor core for control and fidelity
- likely `NSTextView` / TextKit 2 as the editing engine

This is the most credible path to a Raycast Notes-like interaction model.

### Why Not MarkdownView

`MarkdownView` is suitable for rendered display, but this paradigm requires:

- live editable selection
- semantic block editing
- user interactions like list splitting, quote continuation, checkbox toggling
- direct control over attributed text and layout
- reliable mapping from edited rich text back to markdown structure

That makes a real editor surface the core primitive, not a display view.

### Why Not Live Markdown Reveal

Do **not** adopt the Obsidian/Typora pattern where markdown syntax appears inline while editing.

That pattern is valid, but it is not the product target. Specter's rendered mode should stay visually clean and syntax-free, with raw mode reserved for literal markdown editing.

### RichEditorState

The editor adapter should maintain:

```text
RichEditorState
  ├── attributedContent
  ├── block layout map
  ├── selection
  ├── typing attributes
  ├── node/range mapping
  └── pending edit transaction
```

The node/range mapping is essential. It lets Specter answer:

- which model node corresponds to this edited range?
- did the user split a paragraph?
- did the user indent a list item?
- did the user toggle a task checkbox?

---

## Raw Mode

Raw mode remains in the product, but it becomes the **secondary source view**.

### Purpose

Raw mode exists for:

- inspecting exact markdown
- editing unsupported constructs
- recovering from fidelity edge cases
- power users who want direct source control

### Behavior

When switching from rendered to raw:

1. Flush any pending rendered edits into the model
2. Serialize the model to markdown
3. Show that markdown in the source editor

When switching from raw to rendered:

1. Parse the current markdown text
2. Rebuild the structured model
3. Rebuild the rendered editor state
4. Show rendered mode

This makes raw mode the truth-preserving escape hatch.

---

## Save Semantics

### User Mental Model

The user's mental model is correct:

- they edit the rendered mirror
- when they press `Cmd+S`, the markdown file on disk gets updated

### Implementation Reality

To work correctly with `FileDocument`, `SpecterDocument.text` should stay reasonably synchronized in memory during editing.

Practical rule:

- primary rendered edits update the structured model immediately
- markdown serialization runs on a short debounce or transaction boundary
- the resulting markdown string is pushed back into `document.text`
- `Cmd+S` writes the already-synchronized markdown to disk

This avoids the need for a brittle custom save interception layer.

### Flush Triggers

At minimum, flush rendered edits into markdown on:

- short idle debounce after edit
- mode switch
- window deactivation
- explicit save command, if hooked

The key requirement is: `document.text` must never lag meaningfully behind the rendered editor.

---

## Edit Pipeline

### Open Flow

```text
Open file
  → SpecterDocument.text
    → parse markdown
      → build MarkdownDocumentModel
        → build RichEditorState
          → show rendered editor by default
```

### Rendered Edit Flow

```text
User edits rendered surface
  → editor delegate emits edit transaction
    → map affected range to model nodes
      → update MarkdownDocumentModel
        → rebuild affected rich spans/blocks
          → serialize markdown on debounce
            → assign to SpecterDocument.text
```

### Raw Edit Flow

```text
User edits raw markdown
  → sourceMarkdown changes
    → parse markdown
      → rebuild MarkdownDocumentModel
        → rebuild RichEditorState
```

This is the mirror model in operational form.

---

## Default View Behavior

### Opening a File

A `.md` file should open directly into rendered mode.

```swift
@State private var viewMode: ViewMode = .rendered
```

Rendered is not a special preview command. It is the default reading and editing surface.

### Toolbar

The toolbar can initially expose:

- rendered/source toggle
- save uses normal document commands

Do not add formatting chrome until the editor core is trustworthy.

---

## Raycast Notes Reference Qualities

The target is not a pixel clone. It is a behavioral and emotional reference:

- rendered-first
- keyboard-friendly
- beautiful native typography
- unobtrusive chrome
- editable rich surface backed by markdown structure
- fast and calm

For Specter, the difference is that the backing store is a real `.md` file on disk, not an internal notes database.

### Product Pattern

This is closer to the Bear / Ulysses / Raycast family of editors:

- rich rendered editing first
- markdown as persistence or interchange
- source mode as an explicit alternate view

It is **not** the Obsidian live-preview pattern.

---

## Implementation Sequence

### Step 1: Parser / Serializer Spike

Build a spike that round-trips:

- headings
- paragraphs
- lists
- task lists
- block quotes
- code blocks
- bold / italic / links / inline code

This step proves the architecture before any UI polish.

### Step 2: DocumentSession

Create `DocumentSession` and move live editing state out of the raw `FileDocument` struct.

Deliverables:

- source markdown
- structured model
- rich editor state
- markdown synchronization pipeline

### Step 3: Native Rendered Editor Prototype

Build an editable rendered surface using an AppKit-backed text system.

Deliverables:

- block styling
- selection handling
- node/range mapping
- minimal text editing transactions

### Step 4: Rendered-First Open Flow

Open `.md` files straight into rendered mode and keep raw mode as a secondary toggle.

### Step 5: Save Pipeline

Ensure the rendered editor updates `document.text` reliably enough that normal document save writes the latest markdown.

### Step 6: Raw Mode Escape Hatch

Add raw/source mode and safe reparse on switch back to rendered mode.

### Step 7: Unsupported Markdown Handling

Add opaque raw blocks or fallback behaviors for unsupported syntax so v1 does not silently destroy user content.

Rule:

- supported syntax is editable in rendered mode
- unsupported syntax is preserved and edited in raw mode

### Step 8: Polish

Tune typography, spacing, cursor behavior, list editing, and code block interactions until the editor feels calm and native.

---

## Technical Risks Summary

| Risk | Severity | Mitigation |
|---|---|---|
| Round-trip markdown fidelity | High | Start with a constrained supported subset and opaque raw fallbacks. |
| Rich-text edit mapping | High | Build explicit node/range mapping and treat edits as semantic transactions, not plain text diffs. |
| Editor implementation complexity | High | Use a native AppKit-backed editing core instead of forcing this into a display-only renderer. |
| Save synchronization | Medium | Keep `document.text` synchronized continuously in memory rather than only at save time. |
| Unsupported markdown constructs | Medium | Preserve raw blocks and surface raw mode as the escape hatch. |

---

## Recommendation

This is the cleanest architecture if Specter's real goal is:

**"Open a markdown file and edit it in a beautiful rendered native surface by default."**

It is more ambitious than the renderer-preview approach, but it is the right paradigm for the experience you described.
