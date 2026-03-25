# Spectr — Product Spec

Last updated: 2026-03-24

---

## Product Overview

Spectr is a native macOS app for reading and editing markdown files. It exists because nothing else makes markdown look beautiful.

Open a `.md` file. It renders with clean typography, generous spacing, and thoughtful hierarchy. Edit a line. Save. Pin it beside your terminal. That's the whole product.

## Positioning

**The most beautiful way to read and edit markdown on macOS.**

The easiest upgrade to your development workflow. You read markdown every day — it should look incredible. $14.99 once.

## Target User

Anyone who reads markdown files regularly. Developers are the core audience — they live in READMEs, specs, changelogs, and docs every day. But Spectr is for anyone who wants their `.md` files to look good.

They don't need another editor. They need a beautiful surface for the files they already have.

## Core Interaction Model

Spectr has one view with two modes, toggled by ⌘R.

### Rendered Mode (default)
A clean rendered document surface. The document looks like a sheet of paper — clean typography, generous spacing, thoughtful hierarchy. Uses CodeMirror 6 decorations inside a `WKWebView` so markdown stays the source of truth while syntax is visually hidden. Not "rendered HTML in a web view." A designed reading experience.

### Raw Mode
The same document with markdown syntax visible. Make the exact edit you need and move on. Restrained and source-first.

### Toggle
⌘R. Instant switch. No animation delay. No split view.

## Navigation

Navigation is transient. Appear, pick, disappear.

### Quick Open (⌘P)
A floating panel with search and a card grid. Scans the project root for all `.md` files. Each card shows a fingerprint mosaic — a deterministic visual pattern unique to each file's content. Grouped by directory, sorted by proximity. Keyboard and mouse.

### Breadcrumb (rendered mode only)
File path at top. Clickable folder segments for lateral movement.

## Welcome Screen

Shown on launch. App icon, "New Document" and "Open File" cards, recent files list. Dismisses when a document opens.

## Window Model

Each file opens in its own window. No tabs. No sidebar. No split panes.

### Float-on-Top (⌘⇧P)
Pin the window above all other apps. The core spatial feature.

### Reader Width (⌘⇧M)
Toggle between full-width and constrained margins.

## v1 Feature Set

1. **Welcome screen** — New Document, Open File, recent files
2. **Open file** — Any `.md` file from disk
3. **Rendered mode** — Beautiful rendered markdown, editable
4. **Raw mode** — Markdown source with syntax visible
5. **Toggle modes** — ⌘R, instant switch
6. **Save** — ⌘S, FileDocument
7. **Quick Open** — ⌘P, project-wide search with fingerprint cards
8. **Float-on-top** — ⌘⇧P, pin above all windows
9. **Reader width** — ⌘⇧M, toggle margins
10. **Dark/light mode** — Follows system

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| ⌘R | Toggle rendered/raw |
| ⌘P | Quick Open |
| ⌘⇧P | Pin on top |
| ⌘⇧M | Toggle reader margins |
| ⌘N | New document |
| ⌘S | Save |

## Design Philosophy

**No lines.** Zero divider lines anywhere. No hard edges between UI regions.

**Gradient overlays.** Top and bottom bars use vertical gradient fades. Controls float over content, never on solid bars.

**Edge-to-edge.** Content flows to every edge. Chrome floats on top.

**Icon-only.** SF Symbols, Xcode-style. No text labels. Tooltips only.

**Fade on unfocus.** When the window loses focus, all chrome fades out. Only content remains. When focus returns, chrome fades back. Reference: Raycast Notes.

**Formatting bar.** Floats at bottom in raw mode on a gradient fade. Heading, bold, italic, strikethrough, underline, code, link, image, table, lists, blockquote.

## UX Principles

1. **Beautiful** — The primary differentiator. Every pixel is intentional.
2. **Instant** — Opens fast, switches fast. No loading states.
3. **Minimal** — Almost no chrome. The document fills the window.
4. **Calm** — Feels like a document, not an application.
5. **Native** — Feels like it shipped with the Mac.

## Anti-Goals

- **Not Obsidian.** No vault, no graph, no plugins, no linking, no second brain.
- **Not VSCode.** No extensions, no terminal, no git, no forty tabs.
- **Not Notion.** No databases, no blocks, no collaboration, no cloud.
- **Not a Markdown IDE.** No live preview split, no export, no TOC sidebar.
- **Not a file manager.** No file tree, no project concept.

If a feature makes Spectr feel like any of the above, it's wrong for this product.

## Business Model

Open source on GitHub. $14.99 one-time on the Mac App Store (48-hour trial, read-only after expiry). Direct sales via Gumroad. No subscription, ever. See `monetization.md`.

## Technical Constraints

- **SwiftUI** — macOS native
- **FileDocument** — System-managed document lifecycle
- **WindowGroup** — One window per document
- **WKWebView** — Hosts the CodeMirror 6 editor
- **CodeMirror 6** — Shared engine for both modes
- **StoreKit 2** — On-device purchase verification
- **macOS only** — No cross-platform
- **Sandboxed** — Read/write via system dialogs

## Roadmap

### v1 — Ship It
The ten features above plus StoreKit paywall. Ship a beautiful, opinionated markdown viewer that people screenshot and share.

### v2 — Customize + Agent Layer

Personalization (settings, custom colors, typography) and the beginning of agent integration (comment system, CLI skill, agent handoff via comments). See `phase-2-customize-and-agent/game-plan.md` for details.

### Future (not committed)
- Expanded decoration coverage
- Keyboard-driven breadcrumb navigation
- Window state persistence across launches
- Custom file association for `.md`
