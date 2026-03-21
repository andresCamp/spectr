# Specter Phase 1A — Reviewable External Writes

**Iteration spec layered on top of the CM6 decoration architecture**

---

## Intent

This iteration keeps the current architecture:

- one markdown source of truth in `SpecterDocument.text`
- one `WKWebView` hosting one CodeMirror 6 editor
- rendered mode and raw mode as reconfigurations of the same editor

But it changes how Specter reacts to file changes on disk:

- any external write is treated as a **reviewable change**
- Specter does **not** need to know who wrote it
- the user should be able to orient immediately: what changed, where it changed, and what still needs attention

This is not a git feature and not a collaboration system. It is a document review surface over a local markdown file.

---

## Decision Summary

1. **Treat any external write as reviewable.**
2. **Do not model author identity.** Source does not matter.
3. **Use visual review affordances first.** Highlighted ranges, gutter numbers, scrollbar markers, diff peek.
4. **Delay persisted comment anchors until after the review surface exists.**
5. **Fix mode-switch scroll drift first.** It is the cheapest high-value win and improves every later review interaction.

---

## Product Boundaries

### In Scope

- reviewing file changes that appeared on disk
- highlighting inserted/changed sections
- lightweight diff peek for a changed region
- line and block orientation aids
- persisted review comments stored inside the markdown file

### Explicitly Out of Scope

- identifying which process or agent made a write
- git status, branch state, blame, or commit UI
- multi-user presence or collaboration
- a separate preview/editor split
- a second document model or rich-text session architecture

If a feature starts requiring Specter to act like a git client, it has crossed the boundary.

---

## Why This Fits The Current Architecture

The current implementation already has the right base primitives:

- `DocumentFileSyncController` detects external file changes
- `EditorWebView` can push new state into the single CM6 editor
- CodeMirror already supports:
  - decorations
  - widgets
  - custom gutters
  - tooltip overlays
  - scroll restoration by document position
  - changed-line gutter markers and unified diff rendering via the merge package

That means this iteration should stay additive:

- a **review state** above the existing file-sync flow
- a **review decoration layer** inside CodeMirror
- a small amount of new Swift/JS bridge surface

No AST-backed editing model is required.

---

## Core Principle

**External write review is a temporary document state, not a separate mode.**

Specter should continue to edit the current markdown document directly. When the file changes on disk, Specter overlays review context on the same document:

- changed sections become visible
- navigation markers appear
- comments can be attached
- raw/rendered mode still work as before

The markdown remains the source of truth.

---

## Proposed Runtime Model

### Swift Side

Add a lightweight review controller above the existing file monitor behavior.

```text
file changed on disk
  -> read incoming markdown text
  -> compare against previous in-memory text
  -> if identical: clear review state
  -> if local unsaved edits exist: keep existing conflict path for now
  -> else:
       create ExternalWriteReview
       push incoming text into editor
       push review metadata into editor
```

### `ExternalWriteReview`

```text
ExternalWriteReview
  ├── baselineText        // text before external write
  ├── incomingText        // text after external write
  ├── hunks[]             // changed ranges after diff mapping
  ├── sectionAnchors[]    // best-effort block/heading anchors
  ├── createdAt
  ├── activeHunkID?
  └── comments[]
```

This is an in-memory review session for the current file state. It is not a second persistence model.

---

## Review Semantics

### What Counts As Reviewable

Any disk write that changes file contents relative to the text Specter last had in memory.

### What Specter Should Do

When there are no local unsaved changes:

1. accept the new file contents into the editor
2. keep the previous text as the review baseline
3. compute changed hunks
4. highlight those hunks immediately
5. expose navigation markers in the gutter and scroll track

When there are local unsaved changes:

- keep the existing conflict behavior in this iteration
- do **not** attempt an auto-merge yet

This keeps Phase 1A safe.

---

## Section Identity

Specter does not currently have stable persisted section IDs. That is acceptable for the first pass.

### First-Pass Anchoring Strategy

Use best-effort anchors derived from the current markdown structure:

- ATX headings
- fenced code block ranges
- blockquote ranges
- list item ranges
- paragraph block starts

Each review hunk should resolve to:

- a raw character range
- a line range
- an optional containing block/heading anchor

This is enough to support:

- section highlight
- scroll markers
- diff peek placement
- comment placement

It is **not** enough for long-lived robust annotation persistence across major rewrites. That comes later.

---

## UI Behaviors

### 1. Changed Section Highlight

When a review session is active:

- changed blocks receive a rendered-mode highlight
- the highlight should be calm, not code-review loud
- the highlight should wrap the visible rendered block, not just raw inserted characters
- the active changed block gets slightly stronger emphasis

The goal is orientation, not red/green patch theater.

### Initial Rule

- highlight the smallest block range that fully contains the changed hunk
- if no block boundary is available, highlight the changed line span

---

### 2. Hover/Toggle Numbering

Rendered mode should gain a subtle orientation gutter on the left.

Behavior:

- default: hidden
- hover near left margin: numbers fade in lightly
- click gutter area: numbers lock on
- click again: numbers hide
- active hovered line/block number darkens toward primary text color

This should be implemented as a custom CodeMirror gutter, not by drawing independent DOM over the editor.

Important:

- raw mode keeps the current line-number gutter
- rendered mode gets a separate, more ambient gutter
- numbering is for orientation, not editing affordance

---

### 3. Scroll Track Markers

Review state should also appear on the scroll track.

Behavior:

- each changed hunk gets a small marker
- open comments get a distinct marker style
- the active hunk marker is slightly stronger

Implementation note:

- do **not** try to style the native macOS overlay scrollbar
- render a custom lightweight vertical track inside Specter’s window chrome or editor overlay

The native scrollbar remains native. Review markers are separate.

---

### 4. Diff Peek Affordance

Each active changed section may expose a disclosure affordance near the highlight.

Behavior:

- click the chevron/caret
- show the local diff hunk for that section
- collapse again on second click

This is a **document-local diff**, not git UI.

### First-Pass Diff Format

Use a minimal unified patch or before/after snippet for the active hunk only.

### Implementation Strategy

Prefer the smallest viable path:

- first pass: custom hunk widget using already-computed diff ranges
- fallback if the custom diff surface grows: adopt `@codemirror/merge` and `unifiedMergeView` for hunk presentation

The merge package is a tool, not the product model.

---

### 5. Persisted Review Comments

Comments should live in the markdown file, but rendered mode should not show them as raw comment syntax.

### Storage Rule

Use a reserved HTML comment envelope in markdown.

Example shape:

```md
<!-- specter-comment
id: c_001
anchor: heading:Decisions
status: open
This acceptance criterion is still vague.
-->
```

The exact serialization can evolve, but the requirements are:

- valid markdown file content
- invisible or transformed in rendered mode
- parseable by Specter without ambiguity
- removable or markable as resolved

### Rendered Behavior

- raw syntax is hidden in rendered mode
- the anchored region shows a highlight/comment indicator instead
- opening the comment shows its text in a tooltip, popover, or inline callout

### Resolve Behavior

“Resolve” should update or remove the comment envelope in the markdown file.

This allows the CLI agent to later operate on real file-backed comments rather than app-only ephemeral state.

---

### 6. Raw/Rendered Scroll Position Alignment

Current mode switching drifts because the two modes have different typography, padding, and line heights.

The current behavior should not preserve pixel scroll offset. It should preserve **document position**.

### Rule

On mode switch:

1. capture the top visible document line/block
2. capture the relative offset within that block
3. reconfigure the editor mode
4. restore scroll by document position, not percentage or previous pixel offset

### Practical Anchor

Use the top visible line block as the primary anchor. Cursor position alone is not enough when the user is reading rather than editing.

This is the first implementation item because it is independent and improves the feel of the entire app.

---

## Bridge Changes

The Swift/JS bridge needs a small expansion.

### New Swift -> JS pushes

- `setReviewState(review)`
- `clearReviewState()`
- `setReviewActiveHunk(id)`

### New JS -> Swift messages

- `reviewCommentCreated`
- `reviewCommentResolved`
- `reviewHunkSelected`

This is still a narrow bridge. The editor remains the interaction surface.

---

## CodeMirror Integration Notes

Use CM6 primitives already aligned with this architecture:

- `Decoration.mark`, `Decoration.line`, `Decoration.widget`
- custom `gutter(...)` and `GutterMarker`
- tooltip overlays for comment previews
- `lineBlockAtHeight(...)` / viewport line block APIs for visual anchoring
- `scrollIntoView(...)` and scroll snapshot/position effects for mode restoration

Do not introduce a parallel DOM renderer for review features.

---

## Execution Order — Easiest To Hardest

This order optimizes for non-blocking quick wins.

### 1. Line-Based Raw/Rendered Scroll Alignment

Why first:

- self-contained
- no persistence changes
- no review-state dependency
- improves every later feature immediately

Success criteria:

- toggling raw/rendered lands on the same logical text region
- top visible line remains materially stable across repeated toggles

### 2. Rendered Hover/Toggle Number Gutter

Why second:

- local CM6 work only
- no diffing required
- immediate orientation win

Success criteria:

- numbers fade in on hover
- click locks them on and off
- active hovered line/block is emphasized subtly

### 3. External Write Review Highlights

Why third:

- uses existing file-monitor entry point
- biggest functional win after scroll sync
- still avoids persisted comment format

Success criteria:

- any external write enters review state
- changed regions highlight immediately
- active changed section can be navigated

### 4. Scroll Track Review Markers

Why fourth:

- depends on review hunks existing
- still purely visual

Success criteria:

- changed regions are visible on the scroll track
- marker click jumps to the region

### 5. Diff Peek For Active Hunk

Why fifth:

- requires more design and range mapping discipline
- still does not require persisted comment anchors

Success criteria:

- active hunk can expand to show a concise before/after diff
- the feature remains visually calm and does not turn Specter into a code review tool

### 6. Persisted Markdown Comments

Why last:

- this is the first feature that introduces file-backed annotation syntax
- anchors and remapping are the hardest correctness problem in the set

Success criteria:

- creating a comment writes valid structured comment metadata into the markdown file
- rendered mode hides raw comment syntax
- comments can be resolved from Specter and by external tools editing the file

---

## Risk Assessment

### Low Risk

- line-based mode scroll restoration
- rendered gutter numbering
- scroll track markers

### Medium Risk

- hunk-to-block mapping for calm section highlighting
- review state lifecycle when multiple external writes happen rapidly

### High Risk

- persisted comment anchors surviving later document edits
- avoiding comment syntax churn in raw markdown

That is why comments are last.

---

## Acceptance Criteria

- Specter treats any external write as a reviewable change without requiring source attribution.
- The first visible improvement ships with line-based mode-switch scroll restoration.
- Review highlights orient the user to changed sections within one glance.
- Rendered mode gains optional orientation numbering without feeling like a code editor.
- Diff peek remains document-local and does not introduce git surface area.
- Persisted comments, when added, are stored in markdown and hidden/transformed in rendered mode.

---

## Recommended Next Implementation Pass

Ship in this order:

1. scroll alignment
2. rendered review gutter
3. external write highlight flow
4. scroll track markers
5. diff peek
6. persisted comments

If scope needs to tighten further, cut after step 3 and ship. That is already a coherent reviewable external-write iteration.
