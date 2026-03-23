# Spectr Phase 1 — Implementation Spec (CM6 Decoration)

**Editable Rendered Markdown via WKWebView + CodeMirror 6**

---

## Intent

- Opening a `.md` file lands in rendered mode (decorations ON)
- Rendered mode is the primary surface — fully editable, no syntax visible
- Raw mode is the secondary escape hatch — full syntax visible
- Markdown is the source of truth at all times
- The target experience is Raycast Notes for `.md` files on disk

This spec replaces the rendered-first AST round-trip approach. The key insight: **the Raycast Notes experience does not require editing a rendered document and serializing back to markdown. It requires editing markdown that is visually decorated to look rendered.**

---

## Core Principle

The rendered view is NOT a separate document or a preview. It is the same markdown document with visual decorations that hide syntax and apply rich styling. The document is never mutated by the rendering layer. Decorations are purely visual.

There is no custom persisted document model, no markdown regeneration step, and no app-owned parser/serializer pipeline. The only runtime structure is CM6's markdown syntax tree plus the decoration ranges derived from it.

The markdown IS the source of truth. CM6 IS the editor. Decorations ARE the rendering.

---

## System Diagram

```text
.md file on disk
  -> SpectrDocument.text (markdown string, sole source of truth)
    -> WKWebView hosting CodeMirror 6
      -> lezer-markdown parser (built into @codemirror/lang-markdown)
        -> StateField reads parser tree, produces direct Decoration set:
          - Decoration.replace() hides syntax characters (**, ##, ```, etc.)
          - Decoration.mark() applies rich styling (bold, italic, heading sizes)
          - Decoration.widget() inserts interactive elements (checkboxes, HR)
          - Decoration.line() styles block-level elements (code block bg, blockquote border)
        -> EditorView.atomicRanges mirrors hidden/replaced syntax spans
        -> User sees: clean rendered surface
        -> User edits: markdown source, transparently
      -> CM6 handles: undo/redo, selection, IME, accessibility, parser updates
    -> EditorView.updateListener dispatches text to Swift via WKScriptMessageHandler
  -> SpectrDocument.text updated
    -> Cmd+S writes to disk via FileDocument

Raw mode (toggle):
  Same CM6 editor instance
    -> Decoration extension disabled
    -> Monospace theme enabled
    -> Full markdown syntax visible

Mode toggle preserves cursor position and document state.
```

---

## Architecture Overview

### App Shell (SwiftUI)

Unchanged from the existing scaffold:

```swift
@main
struct SpectrApp: App {
    var body: some Scene {
        DocumentGroup(newDocument: SpectrDocument()) { file in
            DocumentView(document: file.$document)
        }
    }
}
```

### SpectrDocument

```swift
import SwiftUI
import UniformTypeIdentifiers

nonisolated struct SpectrDocument: FileDocument {
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
        let data = text.data(using: .utf8)!
        return .init(regularFileWithContents: data)
    }
}
```

The only change from the current codebase: `readableContentTypes` switches from the placeholder `com.example.plain-text` to `UTType.markdown`, and the default text becomes empty.

### DocumentView

```swift
enum ViewMode {
    case rendered
    case raw
}

struct DocumentView: View {
    @Binding var document: SpectrDocument
    @State private var viewMode: ViewMode = .rendered
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        EditorWebView(
            text: $document.text,
            mode: viewMode,
            colorScheme: colorScheme
        )
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    viewMode = viewMode == .rendered ? .raw : .rendered
                } label: {
                    Image(systemName: viewMode == .rendered
                        ? "doc.plaintext"
                        : "doc.richtext")
                }
                .help(viewMode == .rendered ? "Show Raw Markdown" : "Show Rendered")
            }
        }
    }
}
```

### EditorWebView (NSViewRepresentable)

```swift
import SwiftUI
import WebKit

struct EditorWebView: NSViewRepresentable {
    @Binding var text: String
    var mode: ViewMode
    var colorScheme: ColorScheme

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let userContentController = WKUserContentController()
        userContentController.add(context.coordinator, name: "textChanged")
        config.userContentController = userContentController

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView

        // Load the editor bundle from app resources
        if let editorURL = Bundle.main.url(
            forResource: "index",
            withExtension: "html",
            subdirectory: "Editor"
        ) {
            webView.loadFileURL(
                editorURL,
                allowingReadAccessTo: editorURL.deletingLastPathComponent()
            )
        }

        // Transparent background so the web view blends with the window
        webView.setValue(false, forKey: "drawsBackground")

        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self

        guard coordinator.isLoaded else { return }

        // Avoid feedback loops: only push text if it changed externally
        if text != coordinator.lastKnownText {
            coordinator.lastKnownText = text
            coordinator.pushText(text, into: webView)
        }

        // Push mode and theme changes
        let modeStr = mode == .rendered ? "rendered" : "raw"
        coordinator.pushMode(modeStr, into: webView)

        let themeStr = colorScheme == .dark ? "dark" : "light"
        coordinator.pushTheme(themeStr, into: webView)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var parent: EditorWebView
        var webView: WKWebView?
        var lastKnownText: String = ""
        var isLoaded = false

        init(_ parent: EditorWebView) {
            self.parent = parent
            self.lastKnownText = parent.text
        }

        // JS -> Swift: receive text changes
        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            if message.name == "textChanged",
               let text = message.body as? String {
                lastKnownText = text
                DispatchQueue.main.async {
                    self.parent.text = text
                }
            }
        }

        // Set initial text once the page loads
        func webView(
            _ webView: WKWebView,
            didFinish navigation: WKNavigation!
        ) {
            isLoaded = true
            pushText(parent.text, into: webView)
            pushMode(parent.mode == .rendered ? "rendered" : "raw", into: webView)
            pushTheme(parent.colorScheme == .dark ? "dark" : "light", into: webView)
        }

        func pushText(_ text: String, into webView: WKWebView) {
            webView.callAsyncJavaScript(
                "editor.setText(text)",
                arguments: ["text": text],
                in: nil,
                in: .page,
                completionHandler: nil
            )
        }

        func pushMode(_ mode: String, into webView: WKWebView) {
            webView.callAsyncJavaScript(
                "editor.setMode(mode)",
                arguments: ["mode": mode],
                in: nil,
                in: .page,
                completionHandler: nil
            )
        }

        func pushTheme(_ theme: String, into webView: WKWebView) {
            webView.callAsyncJavaScript(
                "editor.setTheme(theme)",
                arguments: ["theme": theme],
                in: nil,
                in: .page,
                completionHandler: nil
            )
        }
    }
}
```

---

## Editor Core (WKWebView + CodeMirror 6)

### File Structure

```
spectr/
  Resources/
    Editor/
      index.html          -- loads CM6 bundle, minimal HTML shell
      editor.js           -- CM6 setup, extensions, decoration field, bridge API
      editor.css          -- base styles (both modes)
      theme-light.css     -- light mode token + layout styles
      theme-dark.css      -- dark mode token + layout styles
```

The JS bundle is built offline (via esbuild or rollup) from npm packages and committed as a single `editor.js` file. No runtime npm or build tooling in the Xcode project.

### index.html

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="editor.css">
  <link rel="stylesheet" href="theme-light.css" id="theme-light">
  <link rel="stylesheet" href="theme-dark.css" id="theme-dark" disabled>
</head>
<body>
  <div id="editor"></div>
  <script src="editor.js"></script>
</body>
</html>
```

### CM6 Configuration

The editor is built from these CM6 packages:

- `@codemirror/state` — EditorState, StateField, transactions, extensions
- `@codemirror/view` — EditorView, Decoration, WidgetType
- `@codemirror/lang-markdown` — markdown() language support (bundles lezer-markdown)
- `@codemirror/language` — syntaxTree, syntaxTreeAvailable
- `@codemirror/commands` — defaultKeymap, history, historyKeymap
- `@codemirror/search` — search, searchKeymap (optional, useful in raw mode)

No additional markdown parser is needed. `@codemirror/lang-markdown` provides the lezer-markdown incremental parser that produces the syntax tree the decoration field reads.

### editor.js — Top-Level Structure

```javascript
import { EditorState, Compartment, StateField } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, keymap } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

// Compartments allow runtime reconfiguration (mode toggle, theme switch)
const decorationCompartment = new Compartment();
const themeCompartment = new Compartment();

// The rendered-mode decoration field (defined below)
const renderedDecorations = buildRenderedDecorationField();

// JS -> Swift bridge: send text changes, debounced
let debounceTimer = null;
const updateListener = EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const text = update.state.doc.toString();
      window.webkit.messageHandlers.textChanged.postMessage(text);
    }, 150);
  }
});

// Base theme shared by both modes
const baseTheme = EditorView.baseTheme({ /* ... */ });

// Themes (defined in detail below)
const renderedTheme = EditorView.theme({ /* ... */ });
const rawTheme = EditorView.theme({ /* ... */ });

const state = EditorState.create({
  doc: "",
  extensions: [
    markdown(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    decorationCompartment.of(renderedDecorations),
    themeCompartment.of(renderedTheme),
    baseTheme,
    updateListener,
  ],
});

const view = new EditorView({
  state,
  parent: document.getElementById("editor"),
});

// Bridge API exposed to Swift
window.editor = {
  setText(text) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  },

  getText() {
    return view.state.doc.toString();
  },

  setMode(mode) {
    const ext = mode === "rendered" ? renderedDecorations : [];
    const theme = mode === "rendered" ? renderedTheme : rawTheme;
    view.dispatch({
      effects: [
        decorationCompartment.reconfigure(ext),
        themeCompartment.reconfigure(theme),
      ],
    });
  },

  setTheme(scheme) {
    document.getElementById("theme-light").disabled = scheme === "dark";
    document.getElementById("theme-dark").disabled = scheme === "light";
  },

  focus() {
    view.focus();
  },
};
```

---

## Decoration Engine

This is the core of the product. A direct CM6 `StateField` reads the lezer-markdown syntax tree and produces the rendered-mode `DecorationSet`. Because the field is exposed through `EditorView.decorations`, it can safely own block replacements, widgets, and any hidden syntax that changes layout.

### How It Works

1. On every document change, the state field rebuilds the rendered `DecorationSet`.
2. It walks the syntax tree using `syntaxTree(state).iterate()`.
3. For each node (Heading, StrongEmphasis, Emphasis, FencedCode, Link, etc.), it emits appropriate `Decoration` objects.
4. The field provides those decorations directly to `EditorView.decorations`.
5. The same field is also exposed through `EditorView.atomicRanges` so cursor motion and deletion treat hidden syntax as atomic spans.
6. CM6 applies the decorations to the rendered DOM — hiding syntax, adding classes, inserting widgets.
7. The underlying document text is never modified.

### Field Implementation

```javascript
function buildRenderedDecorationField() {
  return StateField.define({
    create(state) {
      return buildDecorations(state);
    },

    update(decorations, tr) {
      if (!tr.docChanged) return decorations;
      return buildDecorations(tr.state);
    },

    provide: (field) => [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => view.state.field(field)),
    ],
  });
}

function buildDecorations(state) {
  const decorations = [];

  syntaxTree(state).iterate({
    enter(node) {
      switch (node.name) {
        case "ATXHeading1":
        case "ATXHeading2":
        case "ATXHeading3":
        case "ATXHeading4":
        case "ATXHeading5":
        case "ATXHeading6":
          decorateHeading(decorations, node, state);
          break;
        case "StrongEmphasis":
          decorateStrongEmphasis(decorations, node, state);
          break;
        case "Emphasis":
          decorateEmphasis(decorations, node, state);
          break;
        case "InlineCode":
          decorateInlineCode(decorations, node, state);
          break;
        case "FencedCode":
          decorateFencedCode(decorations, node, state);
          break;
        case "Link":
          decorateLink(decorations, node, state);
          break;
        case "ListItem":
          decorateListItem(decorations, node, state);
          break;
        case "Blockquote":
          decorateBlockquote(decorations, node, state);
          break;
        case "HorizontalRule":
          decorateHorizontalRule(decorations, node, state);
          break;
        case "Task":
          decorateTask(decorations, node, state);
          break;
      }
    },
  });

  return Decoration.set(
    decorations.map((item) => item.decoration.range(item.from, item.to)),
    true
  );
}

function pushDecoration(decorations, from, to, decoration) {
  decorations.push({ from, to, decoration });
}
```

### Decoration Functions

Each function maps a syntax tree node to one or more CM6 decorations.

**Headings:**

```javascript
function decorateHeading(decorations, node, state) {
  // ATXHeading contains: HeaderMark (the # characters), then content
  // Find the HeaderMark child to get the range of # characters + space
  const headerMark = node.node.getChild("HeaderMark");
  if (!headerMark) return;

  // Hide the "## " prefix (HeaderMark + trailing space)
  const hideEnd = Math.min(headerMark.to + 1, node.to);
  pushDecoration(decorations, headerMark.from, hideEnd, Decoration.replace({}));

  // Determine heading level from node name
  const level = parseInt(node.name.replace("ATXHeading", ""));
  const className = `cm-heading-${level}`;

  // Style the heading text
  pushDecoration(
    decorations,
    hideEnd,
    node.to,
    Decoration.mark({ class: className })
  );
}
```

**Bold (StrongEmphasis):**

```javascript
function decorateStrongEmphasis(decorations, node, state) {
  // StrongEmphasis: **text** or __text__
  // EmphasisMark children are the ** delimiters
  const marks = node.node.getChildren("EmphasisMark");
  if (marks.length < 2) return;

  // Hide opening **
  pushDecoration(decorations, marks[0].from, marks[0].to, Decoration.replace({}));
  // Hide closing **
  pushDecoration(decorations, marks[1].from, marks[1].to, Decoration.replace({}));
  // Style the content as bold
  pushDecoration(
    decorations,
    marks[0].to,
    marks[1].from,
    Decoration.mark({ class: "cm-bold" })
  );
}
```

**Italic (Emphasis):**

```javascript
function decorateEmphasis(decorations, node, state) {
  const marks = node.node.getChildren("EmphasisMark");
  if (marks.length < 2) return;

  pushDecoration(decorations, marks[0].from, marks[0].to, Decoration.replace({}));
  pushDecoration(decorations, marks[1].from, marks[1].to, Decoration.replace({}));
  pushDecoration(
    decorations,
    marks[0].to,
    marks[1].from,
    Decoration.mark({ class: "cm-italic" })
  );
}
```

**Inline Code:**

```javascript
function decorateInlineCode(decorations, node, state) {
  // InlineCode: `text`
  // CodeMark children are the ` delimiters
  const marks = node.node.getChildren("CodeMark");
  if (marks.length < 2) return;

  pushDecoration(decorations, marks[0].from, marks[0].to, Decoration.replace({}));
  pushDecoration(decorations, marks[1].from, marks[1].to, Decoration.replace({}));
  pushDecoration(
    decorations,
    marks[0].to,
    marks[1].from,
    Decoration.mark({ class: "cm-inline-code" })
  );
}
```

**Links:**

```javascript
function decorateLink(decorations, node, state) {
  // Link structure: [text](url)
  // Children: LinkMark "[", content, LinkMark "]", LinkMark "(", URL, LinkMark ")"
  const linkMarks = node.node.getChildren("LinkMark");
  const url = node.node.getChild("URL");
  if (!url || linkMarks.length < 4) return;

  // Hide opening [
  pushDecoration(decorations, linkMarks[0].from, linkMarks[0].to, Decoration.replace({}));
  // Hide ](url)
  pushDecoration(decorations, linkMarks[1].from, node.to, Decoration.replace({}));
  // Style the link text
  pushDecoration(
    decorations,
    linkMarks[0].to,
    linkMarks[1].from,
    Decoration.mark({
      class: "cm-link",
      attributes: { title: state.sliceDoc(url.from, url.to) },
    })
  );
}
```

**Fenced Code Blocks:**

```javascript
function decorateFencedCode(decorations, node, state) {
  // FencedCode contains: CodeMark (opening ```), optional CodeInfo, CodeText, CodeMark (closing ```)
  const codeMarks = node.node.getChildren("CodeMark");
  const codeInfo = node.node.getChild("CodeInfo");

  if (codeMarks.length >= 1) {
    // Hide opening fence line (``` + optional language)
    const openEnd = codeInfo ? codeInfo.to : codeMarks[0].to;
    // Find the newline after the opening fence
    const openLineEnd = state.doc.lineAt(openEnd).to;
    pushDecoration(decorations, codeMarks[0].from, openLineEnd + 1, Decoration.replace({}));
  }

  if (codeMarks.length >= 2) {
    // Hide closing fence line
    const closeLine = state.doc.lineAt(codeMarks[1].from);
    pushDecoration(decorations, closeLine.from, codeMarks[1].to, Decoration.replace({}));
  }

  // Apply code block background to each line of content
  // Iterate lines between fences
  const startLine = state.doc.lineAt(node.from).number + 1;
  const endLine = state.doc.lineAt(node.to).number - 1;
  for (let i = startLine; i <= endLine; i++) {
    const line = state.doc.line(i);
    pushDecoration(
      decorations,
      line.from,
      line.from,
      Decoration.line({ class: "cm-code-block-line" })
    );
  }
}
```

**List Items:**

```javascript
function decorateListItem(decorations, node, state) {
  // ListItem contains ListMark (the - or * or 1. marker)
  const listMark = node.node.getChild("ListMark");
  if (!listMark) return;

  // Replace the marker with a styled bullet/number widget
  const markerText = state.sliceDoc(listMark.from, listMark.to).trim();
  const isOrdered = /^\d+[.)]$/.test(markerText);

  // Hide the original marker (including trailing space)
  const hideEnd = Math.min(listMark.to + 1, node.to);
  pushDecoration(
    decorations,
    listMark.from,
    hideEnd,
    Decoration.replace({
      widget: new ListMarkerWidget(isOrdered ? markerText : "bullet"),
    })
  );
}

class ListMarkerWidget extends WidgetType {
  constructor(marker) {
    super();
    this.marker = marker;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-list-marker";
    if (this.marker === "bullet") {
      span.textContent = "\u2022"; // bullet character
    } else {
      span.textContent = this.marker;
    }
    return span;
  }

  eq(other) {
    return this.marker === other.marker;
  }
}
```

**Blockquotes:**

```javascript
function decorateBlockquote(decorations, node, state) {
  // Apply blockquote styling to each line
  // Hide the QuoteMark (> ) on each line
  const quoteMarks = node.node.getChildren("QuoteMark");
  for (const mark of quoteMarks) {
    const hideEnd = Math.min(mark.to + 1, node.to);
    pushDecoration(decorations, mark.from, hideEnd, Decoration.replace({}));
  }

  // Style each line of the blockquote
  const startLine = state.doc.lineAt(node.from).number;
  const endLine = state.doc.lineAt(node.to).number;
  for (let i = startLine; i <= endLine; i++) {
    const line = state.doc.line(i);
    pushDecoration(
      decorations,
      line.from,
      line.from,
      Decoration.line({ class: "cm-blockquote-line" })
    );
  }
}
```

**Checkboxes (Task List Items):**

```javascript
function decorateTask(decorations, node, state) {
  // Task items: - [ ] or - [x]
  // The TaskMarker child contains [ ] or [x]
  const taskMarker = node.node.getChild("TaskMarker");
  if (!taskMarker) return;

  const checked = state.sliceDoc(taskMarker.from, taskMarker.to).includes("x");

  // Replace the checkbox syntax with an interactive widget
  pushDecoration(
    decorations,
    taskMarker.from,
    taskMarker.to,
    Decoration.replace({
      widget: new CheckboxWidget(checked, taskMarker.from),
    })
  );
}

class CheckboxWidget extends WidgetType {
  constructor(checked, pos) {
    super();
    this.checked = checked;
    this.pos = pos;
  }

  toDOM(view) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-checkbox";
    input.addEventListener("click", (e) => {
      const newText = this.checked ? "[ ]" : "[x]";
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 3, insert: newText },
      });
    });
    return input;
  }

  eq(other) {
    return this.checked === other.checked;
  }
}
```

**Horizontal Rules:**

```javascript
function decorateHorizontalRule(decorations, node, state) {
  pushDecoration(
    decorations,
    node.from,
    node.to,
    Decoration.replace({
      widget: new HorizontalRuleWidget(),
      block: true,
    })
  );
}

class HorizontalRuleWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement("hr");
    hr.className = "cm-horizontal-rule";
    return hr;
  }

  eq() {
    return true;
  }
}
```

### Important: Direct Decorations + Sorted Ranges

Rendered mode uses a direct decoration field because block replacements and widgets must be known before layout. The field always collects decorations into an array and returns them via `Decoration.set(..., true)` so nested markdown cannot violate ordering.

That means:

- No `RangeSetBuilder` in the primary implementation
- Block-level replacements are safe to include
- The same direct ranges can also drive `EditorView.atomicRanges`

---

## Swift <-> JS Bridge Protocol

### JS -> Swift Messages

| Message Handler | Payload | Purpose |
|---|---|---|
| `textChanged` | `String` (full document text) | Debounced (150ms) document sync after edits |

### Swift -> JS Calls

| Function | Signature | Purpose |
|---|---|---|
| `editor.setText(text)` | `String -> void` | Push document text into CM6 |
| `editor.getText()` | `void -> String` | Read current document text |
| `editor.setMode(mode)` | `"rendered" \| "raw" -> void` | Toggle decoration + theme compartments |
| `editor.setTheme(scheme)` | `"dark" \| "light" -> void` | Switch CSS theme stylesheets |
| `editor.focus()` | `void -> void` | Focus the CM6 editor |

### Avoiding Feedback Loops

The Coordinator tracks `lastKnownText`. When JS sends `textChanged`, the coordinator updates `lastKnownText` before writing to the binding. In `updateNSView`, text is only pushed to JS if it differs from `lastKnownText`.

Swift pushes values into CM6 via `callAsyncJavaScript(..., arguments:)`, not interpolated JavaScript strings. That keeps the bridge structural instead of quote-sensitive.

---

## Mode Toggle

### Mechanism

Both modes use the same CM6 `EditorView` instance. Mode switching uses CM6 compartment reconfiguration:

```javascript
setMode(mode) {
  const ext = mode === "rendered" ? renderedDecorations : [];
  const theme = mode === "rendered" ? renderedTheme : rawTheme;
  view.dispatch({
    effects: [
      decorationCompartment.reconfigure(ext),
      themeCompartment.reconfigure(theme),
    ],
  });
}
```

### Behavior

- **Rendered mode:** Decoration field active. Syntax hidden. Rich typography theme.
- **Raw mode:** Decoration field removed (empty extension). Monospace theme. Full syntax visible.
- **Toggle is instant** — a single CM6 transaction, no DOM teardown/rebuild.
- **Cursor position preserved** — CM6 maintains selection across reconfiguration.
- **Undo history preserved** — same EditorState, history extension unaffected.

---

## Editing Behavior

### What CM6 + lezer-markdown Gives for Free

- **Typing inside bold/italic regions:** The parser maintains the `**...**` structure. New characters are inserted into the markdown source between the delimiters. The decoration field re-runs on the updated tree and continues to hide the delimiters and style the content.
- **Undo/redo:** CM6's history extension tracks all changes to the markdown source. Works identically in both modes.
- **IME / composition:** CM6 handles input composition natively.
- **Copy/paste:** Pastes as plain text into the markdown source. CM6 handles this.

### What Rendered Mode Still Needs Explicitly

- **Atomic cursor semantics:** Hidden syntax ranges and replacement widgets must be exposed through `EditorView.atomicRanges` so arrow-key movement, backspace, and selection do not land inside invisible tokens.
- **Rendered-mode deletion rules:** Backspace/Delete at the boundary of headings, lists, and tasks still need explicit commands for Raycast-caliber behavior.
- **Widget event discipline:** Interactive widgets like checkboxes must dispatch source changes without fighting CM6 focus or selection.

### What Needs Custom Keybindings/Commands

| Behavior | Why It Needs Custom Handling | Implementation |
|---|---|---|
| Enter in a list item | Should auto-continue the list (`- ` or `1. ` prefix) | `@codemirror/lang-markdown` includes `insertNewlineContinueMarkup` — keep or explicitly rebind it |
| Enter after empty list item | Should end the list (remove the `- ` and outdent) | Same `insertNewlineContinueMarkup` behavior |
| Backspace at start of heading | Should remove the `# ` prefix, converting to paragraph | Custom command: detect cursor at heading content start, delete the HeaderMark range |
| Tab in list | Should indent the list item | Custom command: insert appropriate indentation in source |
| Shift-Tab in list | Should outdent the list item | Custom command: remove indentation in source |
| Checkbox toggle | Click on checkbox widget flips `[ ]` to `[x]` | Handled by the CheckboxWidget's click handler (see above) |
| Bold/italic toggle (Cmd+B, Cmd+I) | Insert/remove `**`/`*` delimiters around selection | Custom commands that wrap/unwrap selection with markdown syntax |

### Custom Keybindings

```javascript
const spectrKeymap = keymap.of([
  {
    key: "Mod-b",
    run: toggleMarkdownWrap("**"),
  },
  {
    key: "Mod-i",
    run: toggleMarkdownWrap("*"),
  },
  {
    key: "Mod-e",
    run: toggleMarkdownWrap("`"),
  },
]);

function toggleMarkdownWrap(delimiter) {
  return (view) => {
    const { state } = view;
    const { from, to } = state.selection.main;
    if (from === to) return false; // no selection

    const selected = state.sliceDoc(from, to);
    const len = delimiter.length;

    // Check if already wrapped
    const before = state.sliceDoc(from - len, from);
    const after = state.sliceDoc(to, to + len);

    if (before === delimiter && after === delimiter) {
      // Remove wrapping
      view.dispatch({
        changes: [
          { from: from - len, to: from, insert: "" },
          { from: to, to: to + len, insert: "" },
        ],
      });
    } else {
      // Add wrapping
      view.dispatch({
        changes: [
          { from, insert: delimiter },
          { from: to, insert: delimiter },
        ],
        selection: { anchor: from + len, head: to + len },
      });
    }
    return true;
  };
}
```

### Edge Cases to Test

- Deleting all text inside `**...**` then the delimiters themselves — should cleanly remove the empty bold node
- Pasting markdown-formatted text into a bold region — inserts as raw text, parser re-evaluates
- Nested formatting (`***bold italic***`) — decoration field must handle nested EmphasisMark nodes
- Headings with trailing `#` characters — `## Heading ##` — hide both leading and trailing marks
- Multi-line list items — continuation lines should maintain list styling
- Code blocks containing markdown syntax — must NOT be decorated (lezer-markdown correctly scopes these as CodeText, not as formatting)

---

## Rendered Mode Styling

### Typography

```css
/* editor.css — rendered mode base */
.cm-editor {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  font-size: 15px;
  line-height: 1.7;
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 24px;
}

.cm-heading-1 { font-size: 28px; font-weight: 700; line-height: 1.3; margin-top: 1.5em; }
.cm-heading-2 { font-size: 22px; font-weight: 600; line-height: 1.35; margin-top: 1.4em; }
.cm-heading-3 { font-size: 18px; font-weight: 600; line-height: 1.4; margin-top: 1.3em; }
.cm-heading-4 { font-size: 16px; font-weight: 600; line-height: 1.45; }
.cm-heading-5 { font-size: 15px; font-weight: 600; line-height: 1.5; }
.cm-heading-6 { font-size: 14px; font-weight: 600; line-height: 1.5; color: var(--text-muted); }

.cm-bold { font-weight: 600; }
.cm-italic { font-style: italic; }

.cm-inline-code {
  font-family: "SF Mono", SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  background: var(--code-bg);
  border-radius: 3px;
  padding: 1px 4px;
}

.cm-code-block-line {
  font-family: "SF Mono", SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  background: var(--code-bg);
  padding: 0 12px;
}

.cm-link {
  color: var(--link-color);
  text-decoration: underline;
  text-decoration-color: var(--link-underline);
  cursor: pointer;
}

.cm-list-marker {
  display: inline-block;
  width: 1.2em;
  color: var(--text-muted);
  text-align: center;
}

.cm-blockquote-line {
  border-left: 3px solid var(--blockquote-border);
  padding-left: 16px;
  color: var(--text-muted);
}

.cm-checkbox {
  margin-right: 6px;
  transform: scale(1.1);
  cursor: pointer;
}

.cm-horizontal-rule {
  border: none;
  border-top: 1px solid var(--divider-color);
  margin: 24px 0;
}
```

### Light Theme

```css
/* theme-light.css */
:root {
  --text-primary: #1d1d1f;
  --text-muted: #86868b;
  --bg-primary: #ffffff;
  --code-bg: #f5f5f7;
  --link-color: #0066cc;
  --link-underline: rgba(0, 102, 204, 0.3);
  --blockquote-border: #d2d2d7;
  --divider-color: #d2d2d7;
  --selection-bg: rgba(0, 102, 204, 0.15);
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.cm-editor .cm-selectionBackground { background: var(--selection-bg); }
.cm-editor.cm-focused .cm-cursor { border-left-color: var(--text-primary); }
```

### Dark Theme

```css
/* theme-dark.css */
:root {
  --text-primary: #f5f5f7;
  --text-muted: #86868b;
  --bg-primary: #1d1d1f;
  --code-bg: rgba(255, 255, 255, 0.06);
  --link-color: #4da3ff;
  --link-underline: rgba(77, 163, 255, 0.3);
  --blockquote-border: #48484a;
  --divider-color: #48484a;
  --selection-bg: rgba(77, 163, 255, 0.2);
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.cm-editor .cm-selectionBackground { background: var(--selection-bg); }
.cm-editor.cm-focused .cm-cursor { border-left-color: var(--text-primary); }
```

### Native Feel Checklist

- No scrollbar gutter flash — use `overflow: overlay` or hide scrollbar with CSS
- No blue focus ring on the web view — suppress with `outline: none` on `.cm-editor`
- No text selection highlight that looks "webby" — use `::selection` with macOS-native blue
- No bounce/overscroll that feels like Safari — set `overscroll-behavior: none`
- Hide CM6's default gutter (line numbers) — not needed in rendered mode
- Hide CM6's active line highlight — or make it extremely subtle

---

## Raw Mode Styling

```css
/* Raw mode theme (applied via CM6 theme compartment) */
.cm-editor.cm-raw {
  font-family: "SF Mono", SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 1.6;
  max-width: none;
  padding: 24px;
}
```

Raw mode shows the full markdown source with no decorations. It is a standard code editor feel. Line numbers may optionally be shown. The same dark/light CSS variables apply.

---

## Implementation Sequence

### Step 1: WKWebView + CM6 Scaffold

**Goal:** Prove the plumbing works.

- Create `Resources/Editor/` directory with `index.html`, `editor.js`, `editor.css`
- Bundle CM6 packages via esbuild into a single `editor.js`
- Create `EditorWebView` (NSViewRepresentable wrapping WKWebView)
- Load the editor HTML from the app bundle
- Establish the Swift <-> JS bridge:
  - `editor.setText()` pushes text from Swift to CM6
  - `textChanged` message handler sends text from CM6 to Swift
- Wire `EditorWebView` into `DocumentView` with `$document.text` binding
- Update `SpectrDocument.readableContentTypes` to `[.markdown]`

**Verify:** Open a `.md` file from Finder. See raw markdown in CM6. Edit. Save with Cmd+S. Reopen, edits preserved.

### Step 2: Decoration Field — Inline Formatting

**Goal:** First visible proof of the rendered experience.

- Build the direct `StateField` with `buildRenderedDecorationField()`
- Implement decorations for: bold, italic, inline code, links
- Hide syntax delimiters with `Decoration.replace({})`
- Apply styling with `Decoration.mark({ class: "..." })`
- Add CSS classes for `.cm-bold`, `.cm-italic`, `.cm-inline-code`, `.cm-link`
- Verify `EditorView.atomicRanges` keeps cursor motion out of hidden delimiters

**Verify:** Open a file with `**bold**` and `*italic*` — see clean styled text, no asterisks.

### Step 3: Decoration Field — Block Formatting

**Goal:** Full rendered surface for real documents.

- Add heading decorations (hide `#` prefix, apply heading size classes)
- Add list item decorations (hide `- `/`1. `, insert bullet/number widgets)
- Add code block decorations (hide fences, apply code block background)
- Add blockquote decorations (hide `>`, apply border + indent)
- Add checkbox decorations (interactive toggle widget)
- Add horizontal rule decorations (styled `<hr>` widget)
- Keep block replacements in the direct decoration field, not an indirect provider

**Verify:** Open a real spec document (like this one). See a fully rendered view. All major elements styled.

### Step 4: Mode Toggle

**Goal:** Raw mode escape hatch.

- Add `ViewMode` enum and toggle button in toolbar
- Implement `editor.setMode()` using CM6 compartment reconfiguration
- Create raw mode theme (monospace, no decorations)
- Ensure cursor position and undo history survive the toggle

**Verify:** Toggle rendered <-> raw. Content identical. Cursor stays. Undo works across toggle.

### Step 5: Typography + Theme Polish

**Goal:** The "Raycast Notes" feel.

- Tune rendered mode CSS: font sizes, line spacing, heading margins, code block padding
- Implement dark/light theme CSS with macOS semantic colors
- Wire `colorScheme` changes to `editor.setTheme()`
- Center content at max 720px readable width
- Suppress all web-view artifacts (scrollbar flash, focus ring, overscroll bounce)

**Verify:** Side-by-side with Raycast Notes. Feels calm, native, beautiful. No "web view" tells.

### Step 6: Editing Behavior Polish

**Goal:** Editing is predictable and natural.

- Wire `insertNewlineContinueMarkup` for Enter in lists
- Build custom command for Backspace at heading start
- Build Cmd+B / Cmd+I / Cmd+E toggle commands
- Add Tab/Shift-Tab for list indentation
- Validate atomic cursor movement around headings, list markers, tasks, and code fences
- Test undo/redo across all formatting operations
- Test nested formatting (bold inside heading, italic inside bold)
- Test code blocks containing markdown syntax (must not be decorated)

**Verify:** Editing markdown through the rendered surface is natural. No surprises. The user never needs to think about the underlying syntax.

### Step 7: Integration Polish

**Goal:** Feels like a native macOS document app.

- File association: `.md` files open in Spectr from Finder
- Multi-window: each document in its own window via `DocumentGroup`
- Window title: shows the filename
- Dark/light mode: auto-switches with system appearance
- Cmd+N: creates a new empty document (default `DocumentGroup` behavior)

**Verify:** A developer can use Spectr as their daily spec viewer. Open files, read in rendered mode, make quick edits, save, switch to raw mode for tricky syntax.

---

## Technical Risks

| Risk | Severity | Mitigation |
|---|---|---|
| CM6 decoration complexity for full syntax hiding | Medium | Layer incrementally: inline first (Step 2), then blocks (Step 3). Each element is independent. |
| WKWebView native feel | Medium | Invest in CSS theme polish (Step 5). Suppress all web-view artifacts. Reference MarkEdit as proof this works. |
| Swift <-> JS bridge reliability | Low | Use `callAsyncJavaScript(..., arguments:)` for Swift -> JS calls, keep `lastKnownText` for feedback-loop prevention, and debounce outbound text sync. |
| Editing behavior with hidden syntax | Medium | Atomic ranges are required for cursor semantics. Custom commands still handle list continuation, heading deletion, formatting toggles, and widget interaction. Test each in Step 6. |
| lezer-markdown parser tree node names | Low | Node names may differ slightly from what is documented. Build Step 2 with console logging of actual tree structure to verify node names before writing decoration functions. |
| Font loading in WKWebView | Low | Use system font CSS stack (`-apple-system`, `SF Mono`). No font bundling needed. |
| Phase creep | High | Launcher, formatting bar, custom chrome, float-on-top, breadcrumb, card switcher are ALL out of scope. The toolbar has one button: mode toggle. |

---

## What This Approach Eliminates

The rendered-first AST round-trip spec required:

- `MarkdownDocumentModel` — custom structured document model
- `MarkdownParser` — custom parser mapping to the model
- `MarkdownSerializer` — custom serializer regenerating markdown from the model
- `DocumentSession` — reference type managing editing state
- `RichEditorState` — editor adapter with node/range mapping
- Semantic edit transactions — mapping rich text edits back to model mutations
- Flush/sync pipeline — debounced serialization from model to `document.text`
- Opaque raw blocks — fallback strategy for unsupported syntax
- NSTextView / TextKit 2 — AppKit text editing engine

**All of this is eliminated.**

The new architecture has:

- `SpectrDocument { text: String }` — the markdown string, unchanged
- `WKWebView` + `EditorWebView` — the native shell
- `CodeMirror 6` — the editor engine (parsing, editing, undo, selection, accessibility)
- One direct `StateField` — the decoration engine that hides syntax, applies styling, and supplies atomic ranges
- CSS — the visual layer
- A small Swift <-> JS bridge — text sync and commands

The complexity budget goes into one place: the decoration field. Everything else is off-the-shelf.
