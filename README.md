# Spectr

A native macOS markdown editor for spec-driven development.

<!-- screenshot -->

## What it is

Spectr is a lightweight macOS app that opens `.md` files in a clean, distraction-free window. It provides two editing modes -- rendered view with live decorations and raw view with syntax highlighting -- so you can read and write specs without leaving your workflow. Designed to sit beside your terminal while you work.

## Features

- Rendered mode with live decorations (headings, lists, code blocks, tables, links)
- Raw mode with syntax highlighting and line numbers
- Quick Open (`Cmd+P`) with file fingerprint visualization
- Pinch-to-zoom with snap-to-default
- External file change detection with conflict resolution
- Dark and light mode follows system
- Float-on-top window pin

## Architecture

Spectr is a SwiftUI document-based app. The markdown string in `SpectrDocument` is the single source of truth. The editor surface is a CodeMirror 6 instance running inside a `WKWebView`, communicating with Swift through a `WKScriptMessageHandler` bridge. The editor bundle is built with esbuild and checked into the repo.

```
SpectrApp (SwiftUI DocumentGroup)
  └─ DocumentView
       └─ EditorWebView (WKWebView)
            └─ CodeMirror 6 (decorations, not preview)
```

## Tech Stack

- Swift / SwiftUI / WebKit
- CodeMirror 6
- TypeScript + esbuild

## Getting Started

```sh
git clone https://github.com/andresCamp/spectr.git
cd spectr
open spectr.xcodeproj
# Cmd+R to build and run
```

To rebuild the editor bundle:

```sh
cd tools/editor
npm install
npm run build
```

To install to `/Applications`:

```sh
./install.sh
```

## License

MIT
