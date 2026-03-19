# Specter — Product Spec

Last updated: 2026-03-19

---

## Product Overview

Specter is a native macOS companion app for spec-driven development. It provides a quiet, minimal window for viewing and lightly editing markdown specs alongside your terminal and editor.

It fills a specific gap in the developer workflow: the thinking layer. Your terminal executes. Your editor creates. Specter holds the spec — the document that governs what you're building and why.

## Target User

Developers who work spec-first. They write product specs, architecture docs, or decision logs before (and during) implementation. They use a terminal-centric workflow. They value clarity, minimalism, and tools that stay out of the way.

They don't need another editor. They need a dedicated surface for the document they keep referencing.

## Core Interaction Model

Specter has one view with two modes, toggled by a single button that is always accessible.

### Raw Mode
An editable markdown surface (TextEditor). Plain text. You see the markdown syntax. You type, you fix a line, you move on. This is not a full editor — no syntax highlighting, no vim bindings, no autocomplete. It's a text field for quick edits.

### Rendered Mode
A clean, read-only document view. Phase 1 uses `MarkdownView` for markdown rendering so Specter can ship with strong markdown fidelity quickly. A custom renderer can come later if the product needs more control. The document should look like a sheet of paper — clean typography, generous spacing, thoughtful hierarchy. Not "rendered HTML in a web view."

### Toggle
One button. Press it, the mode switches instantly. No animation delay. No split view. You're either reading or editing. That's it.

## Navigation Model

Navigation in Specter is transient. Elements appear when needed and disappear after selection. There is no persistent navigation UI.

### Breadcrumb (rendered mode only)
The file path appears at the top of the rendered view. Each folder segment is clickable — tap a folder to see its children as a list. Pick a file, it opens. The breadcrumb disappears back to its passive state. This is for quick lateral movement within a directory.

### Card Switcher
Triggered by a button in the top-left corner or by ⌘K. When activated, the current document blurs and a flat grid of cards appears. Each card shows a rendered markdown preview of an open document with the breadcrumb/file path on the card itself. Paginated at 20 cards with a "show more" option.

Pick a card, it opens. Press Escape, it closes. The switcher is for jumping between open specs.

The breadcrumb/path appears on each card in the switcher — NOT in the main document view. The document view itself has no breadcrumb. It shows only the title, content, and floating controls.

Both navigation elements share the same principle: appear, pick, disappear.

## Window Model

Each spec opens in its own window via WindowGroup. No tabs. No sidebar. No split panes.

This is a spatial workflow. The developer positions Specter windows beside their terminal, arranging their workspace physically. Each window is a single document.

### Float-on-Top
A pin icon in the title bar toggles float-on-top mode. When active, the Specter window stays above all other applications. This is the core spatial feature — pin your spec above your terminal so it's always visible while you work.

## v1 Feature Set

1. **New window** — ⌘N creates a new empty spec window
2. **Open file** — Open any .md file from disk
3. **Edit markdown** — Raw mode with TextEditor
4. **Render markdown** — Rendered mode with MarkdownView in Phase 1
5. **Toggle modes** — Single button switches between raw and rendered, always accessible
6. **Save file** — Standard ⌘S, backed by FileDocument
7. **Breadcrumb navigation** — File path in rendered view, clickable folder segments
8. **Card switcher** — Top-left button + ⌘K, grid of open document previews
9. **Float-on-top toggle** — Pin icon in title bar, keeps window above all apps
10. **Dark/light mode** — Follows system appearance automatically

This is the complete v1. Nothing else ships in v1.

## UI Chrome Philosophy

Specter has no divider lines anywhere in the app. Zero hard edges between UI regions.

- **Gradient overlays** — Top and bottom bars use vertical linear gradient fades (transparent to opaque). Controls float over content on these faded overlays, never on solid bars.
- **Edge-to-edge content** — Content flows to every edge of the window. Chrome floats on top of it, not beside or separated from it.
- **Icon-only controls** — All title bar buttons are icon-only with tooltips. No text labels.
- **SF Symbols** — All icons use SF Symbols matching Xcode's icon style: monochrome, native.

### Raw Mode Bottom Bar

A markdown formatting toolbar floats at the bottom of raw/edit mode on a vertical linear fade (not a solid bar).

Controls: heading dropdown (H with chevron), bold, italic, strikethrough, underline, code, link, image, table, ordered list, unordered list, blockquote.

SF Symbol icons, Xcode-style. No dividers between icons.

### Focus/Unfocus Behavior

When the window loses focus, all chrome (buttons, title, formatting bar) fades out. Only content remains visible. The window becomes a pure projection surface.

When the window gains focus, chrome fades back in.

Reference: Raycast Notes fade-on-unfocus behavior.

## UX Principles

1. **Instant** — Opens fast, switches fast. No loading states, no spinners.
2. **Minimal** — Almost no UI chrome. The document fills the window.
3. **Calm** — Feels like a document, not an application. No urgency, no notifications.
4. **Ambient** — Always there, never distracting. A presence, not a demand.
5. **Native** — Feels like it shipped with the Mac. System fonts, system colors, system behaviors.

## Anti-Goals (What Specter is NOT)

- **Not Notion.** No databases, no blocks, no collaboration, no cloud sync.
- **Not VSCode.** No syntax highlighting, no extensions, no terminal integration, no git.
- **Not a Markdown IDE.** No live preview split, no export to PDF, no table-of-contents sidebar.
- **Not a file manager.** No file tree, no project concept, no workspace files.
- **Not a second brain.** No linking, no tagging, no search-everything, no graph view.

If a feature makes Specter feel like any of the above, it is wrong for this product.

## Product Position

```
Terminal (Ghostty)  →  Execution    (run, test, deploy)
Specter             →  Thinking     (read, reference, refine)
Editor (VSCode)     →  Creation     (write code, build features)
```

Specter is the middle layer. It doesn't replace either side. It exists because the other two are too loud for the job of holding a spec quietly.

## Technical Constraints

- **SwiftUI** — Declarative UI, modern macOS framework
- **FileDocument** — Value-type document model, system-managed lifecycle
- **WindowGroup** — Each document gets its own native window
- **MarkdownView** — Phase 1 markdown rendering; custom renderer can come later
- **TextEditor** — Native text editing for raw mode
- **macOS only** — No iOS, no iPadOS, no cross-platform
- **Minimal dependencies** — Phase 1 permits `MarkdownView` to accelerate shipping
- **Sandboxed** — Read/write file access via system file dialogs

## Roadmap

### v1 — Locked
The ten features listed above. The goal is a functional, opinionated spec viewer that a developer can keep open all day.

### Future Considerations (not committed)
- **Auto-reload** — Watch the file on disk and reload when it changes externally (e.g., when Claude Code writes to a spec). This is high-value for the terminal workflow.
- **Typography refinements** — Custom font choices, adjustable spacing, reader-mode polish.
- **Custom markdown renderer** — Replace `MarkdownView` with a more opinionated in-house renderer if Specter outgrows the dependency.
- **Keyboard-driven navigation** — Full keyboard flow for breadcrumb and card switcher.
- **Window state persistence** — Remember window positions and open documents across launches.
- **Custom file association** — Own the .md extension or a custom extension for spec files.

These are directions, not promises. Each will be evaluated against the core principles before any work begins.
