# Phase 1 — Existing Markdown Surface

**Objective:** Ship the smallest useful version of Specter: open an existing `.md` file, switch between raw and rendered views, make a light edit, and save.

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
2. Raw mode using `TextEditor`
3. Rendered mode using `MarkdownView`
4. Raw/rendered toggle
5. Save via `FileDocument`
6. Dark/light mode follows system

## Out of Scope

- Custom new-document launcher on Cmd+N
- `~/Documents/Specter/` creation flow
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

**Raw mode:** Plain SwiftUI `TextEditor` bound to the document text.

**Rendered mode:** Use `MarkdownView` from `https://github.com/LiYanan2004/MarkdownView`. This keeps Phase 1 fast to ship and gives much better markdown fidelity than native `AttributedString` rendering. A custom renderer can come later.

**Window behavior:** Stay with default document window behavior in Phase 1. No custom `NSWindow` bridging yet.

---

## Implementation Sequence

1. **Document model + file associations** — switch to `UTType.markdown`, verify open/save for `.md` files.
2. **Raw mode** — keep the editor simple with `TextEditor`.
3. **Rendered mode** — add `MarkdownView` via Swift Package Manager and tune spacing/typography.
4. **Mode toggle** — add a simple raw/rendered toggle, preferably in the standard toolbar.
5. **Polish pass** — verify real markdown docs, dark/light mode, and basic multiwindow behavior.

---

## Risks and Open Questions

- **MarkdownView dependency.** Phase 1 now intentionally accepts a third-party dependency. Verify package integration and lock the exact dependency strategy before implementation.
- **Rendered styling.** `MarkdownView` gives fidelity, but Specter still needs a restrained visual treatment so it feels document-like rather than blog-like.
- **Phase boundary discipline.** The biggest risk is re-expanding scope by pulling the launcher, formatting bar, or custom window behavior back into Phase 1.
