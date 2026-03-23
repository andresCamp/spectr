# Spectr Phase 1 — Legacy MarkdownView Spec

This document is retained only as historical context.

Phase 1 no longer follows the `TextEditor` + `MarkdownView` split described here. The implemented direction is the CodeMirror 6 decoration approach documented in [spectr--implementation-spec-cm6.md](./spectr--implementation-spec-cm6.md):

- one markdown source of truth in `SpectrDocument.text`
- one `WKWebView`-hosted CodeMirror 6 editor for both modes
- rendered mode via markdown decorations
- raw mode via the same editor with decorations disabled

Use `spectr--implementation-spec-cm6.md` as the current implementation spec.
