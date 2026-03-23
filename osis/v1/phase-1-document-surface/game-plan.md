# Phase 1 — Existing Markdown Surface

**Objective:** Ship the smallest useful version of Spectr: open an existing `.md` file, switch between raw and rendered views, make a light edit, and save.

---

## Success Criteria

- A developer can open any `.md` file from Finder or File > Open.
- They can switch between raw and rendered modes instantly.
- They can make a small markdown edit and save it with the normal document flow.
- Rendered mode is readable and visually calm on real spec documents.
- Multiple windows work through the standard document app behavior.

---

## Scope

1. Open existing `.md` files
2. Raw mode using the same CodeMirror 6 editor with syntax visible
3. Rendered mode using CodeMirror 6 decorations in a `WKWebView`
4. Raw/rendered toggle
5. Save via `FileDocument`
6. Dark/light mode follows system

## Out of Scope

- Custom new-document launcher on Cmd+N
- `~/Documents/Spectr/` creation flow
- Formatting bar
- `NSTextView` bridge
- Float-on-top
- Focus/unfocus chrome fade
- Custom chrome gradients
- Breadcrumb navigation
- Card switcher
- Custom markdown renderer
- Export, print, or any output format

---

## Technical Approach

**Document model:** `FileDocument` value type with `UTType.markdown`.

**App shell:** `DocumentGroup(newDocument:)` remains the simplest editable document app setup. Phase 1 does not customize the default new-document flow.

**Raw mode:** The same CodeMirror 6 editor instance with decorations disabled and a monospace theme.

**Rendered mode:** Use CodeMirror 6 in a `WKWebView`, keeping markdown as the source of truth and hiding syntax through decorations instead of rendering a separate preview document.

**Editor bundle:** Keep a repo-local JS workspace that builds a checked-in `editor.js` bundle for Xcode to consume as a static app resource. Xcode does not run npm/bun.

**Window behavior:** Stay with default document window behavior in Phase 1. No custom `NSWindow` bridging yet.

---

## Implementation Sequence

1. **Document model + file associations** — switch to `UTType.markdown`, verify open/save for `.md` files.
2. **Editor shell** — load the bundled CodeMirror 6 editor in `WKWebView` and connect the Swift/JS bridge.
3. **Rendered decorations** — implement the initial markdown decoration set for headings, emphasis, links, lists, blockquotes, code fences, tasks, and horizontal rules.
4. **Mode toggle** — switch the same editor instance between rendered and raw modes through compartment reconfiguration.
5. **Polish pass** — tune typography/theme behavior and verify real markdown docs plus basic multiwindow behavior.

---

## Risks and Open Questions

- **Decoration complexity.** The cursor/editing semantics have to stay correct while syntax is hidden. Keep atomic ranges separate from visible styling ranges.
- **Bridge reliability.** Swift and JS must stay synchronized without feedback loops or trailing debounces that can leave `SpectrDocument.text` stale.
- **Rendered styling.** The web view has to disappear visually so Spectr still feels document-like rather than browser-like.
- **Phase boundary discipline.** The biggest risk is re-expanding scope by pulling the launcher, formatting bar, or custom window behavior back into Phase 1.
