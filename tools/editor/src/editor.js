import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  insertNewlineContinueMarkup,
  markdown,
} from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { Autolink, TaskList } from "@lezer/markdown";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands";

const fromSwiftAnnotation = Annotation.define();
const autoAdvanceHorizontalRuleAnnotation = Annotation.define();
const decorationCompartment = new Compartment();
const themeCompartment = new Compartment();
const modeClassCompartment = new Compartment();
const layoutClassCompartment = new Compartment();
const gutterCompartment = new Compartment();
const activeLineCompartment = new Compartment();
const scrollBehaviorCompartment = new Compartment();

let currentMode = "rendered";
const customTaskPattern = /^(\s*)(\[\]|\[(?:x|X)\])(\s+)/;
const bareDomainPattern = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<]*)?/gi;
const horizontalRulePattern = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const blockedLineWidgetContexts = new Set([
  "CodeBlock",
  "CodeText",
  "Comment",
  "CommentBlock",
  "FencedCode",
  "HTMLBlock",
  "HTMLTag",
  "InlineCode",
  "ProcessingInstruction",
  "ProcessingInstructionBlock",
]);
const minimumTextScale = 11 / 15;
const maximumTextScale = 2;

function safePostMessage(name, body) {
  const handler = globalThis.webkit?.messageHandlers?.[name];
  if (!handler) {
    return;
  }
  handler.postMessage(body);
}

function reportError(message, extra = {}) {
  console.error("[Specter Editor]", message, extra);
  safePostMessage("editorError", {
    message,
    ...extra,
  });
}

globalThis.addEventListener("error", (event) => {
  reportError(event.message || "Unhandled editor error", {
    filename: event.filename ?? null,
    line: event.lineno ?? null,
    column: event.colno ?? null,
  });
});

globalThis.addEventListener("unhandledrejection", (event) => {
  reportError("Unhandled promise rejection", {
    reason: String(event.reason),
  });
});

function emptyRenderArtifacts() {
  return {
    decorations: Decoration.none,
    atomicRanges: Decoration.none,
  };
}

function createAtomicRange(from, to) {
  return Decoration.mark({ class: "cm-hidden-syntax" }).range(from, to);
}

function buildRenderedArtifactsField() {
  return StateField.define({
    create(state) {
      return buildRenderArtifacts(state);
    },
    update(value, transaction) {
      if (!transaction.docChanged && !transaction.selection) {
        return value;
      }
      return buildRenderArtifacts(transaction.state);
    },
    provide(field) {
      return [
        EditorView.decorations.from(field, (value) => value.decorations),
        EditorView.atomicRanges.of((view) => view.state.field(field).atomicRanges),
      ];
    },
  });
}

function buildRenderArtifacts(state) {
  const decorations = [];
  const atomicRanges = [];
  const standardTaskLines = new Set();
  const renderedListLines = new Set();
  const tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      switch (node.name) {
        case "ATXHeading1":
        case "ATXHeading2":
        case "ATXHeading3":
        case "ATXHeading4":
        case "ATXHeading5":
        case "ATXHeading6":
          decorateHeading(decorations, atomicRanges, node, state);
          break;
        case "StrongEmphasis":
          decorateStrongEmphasis(decorations, atomicRanges, node, state);
          break;
        case "Emphasis":
          decorateEmphasis(decorations, atomicRanges, node, state);
          break;
        case "InlineCode":
          decorateInlineCode(decorations, atomicRanges, node, state);
          break;
        case "Link":
          decorateLink(decorations, atomicRanges, node, state);
          break;
        case "URL":
          decorateUrl(decorations, node, state);
          break;
        case "ListItem":
          decorateListItem(
            decorations,
            atomicRanges,
            node,
            state,
            standardTaskLines,
            renderedListLines,
          );
          break;
        case "Blockquote":
          decorateBlockquote(decorations, atomicRanges, node, state);
          break;
        case "FencedCode":
          decorateFencedCode(decorations, atomicRanges, node, state);
          break;
        case "HorizontalRule":
          decorateHorizontalRule(decorations, atomicRanges, node, state);
          break;
        default:
          break;
      }
    },
  });
  decorateBareTaskLines(decorations, atomicRanges, state, tree, standardTaskLines);
  decoratePendingListLines(decorations, atomicRanges, state, tree, renderedListLines);
  decorateBareDomains(decorations, state, tree);

  return {
    decorations: Decoration.set(decorations, true),
    atomicRanges: Decoration.set(atomicRanges, true),
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getWheelLineUnits(event, view) {
  const lineHeight = Math.max(1, view.defaultLineHeight || 1);

  switch (event.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return event.deltaY;
    case WheelEvent.DOM_DELTA_PAGE:
      return event.deltaY * Math.max(1, Math.floor(view.scrollDOM.clientHeight / lineHeight));
    default:
      return event.deltaY / lineHeight;
  }
}

function scrollRawViewByLines(view, lineDelta) {
  if (!lineDelta) {
    return false;
  }

  const lineHeight = Math.max(1, view.defaultLineHeight || 1);
  const scroller = view.scrollDOM;
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const nextScrollTop = clamp(
    scroller.scrollTop + (lineDelta * lineHeight),
    0,
    maxScrollTop,
  );

  if (nextScrollTop === scroller.scrollTop) {
    return false;
  }

  scroller.scrollTop = nextScrollTop;
  return true;
}

function addReplacement(decorations, atomicRanges, from, to, spec = {}) {
  if (from >= to) {
    return;
  }
  decorations.push(Decoration.replace(spec).range(from, to));
  atomicRanges.push(createAtomicRange(from, to));
}

function addMark(decorations, from, to, className, attributes) {
  if (from >= to) {
    return;
  }
  decorations.push(
    Decoration.mark({
      class: className,
      attributes,
    }).range(from, to),
  );
}

function addLineClass(decorations, from, className) {
  decorations.push(Decoration.line({ class: className }).range(from));
}

function decorateHeading(decorations, atomicRanges, node, state) {
  const line = state.doc.lineAt(node.from);
  const text = line.text;
  const match = /^(#{1,6})(\s+)(.*?)(\s+#+\s*)?$/.exec(text);
  if (!match) {
    return;
  }

  const level = match[1].length;
  const prefixEnd = line.from + match[1].length + match[2].length;
  addReplacement(decorations, atomicRanges, line.from, prefixEnd);

  let contentEnd = line.to;
  if (match[4]) {
    contentEnd -= match[4].length;
    addReplacement(decorations, atomicRanges, contentEnd, line.to);
  }

  addLineClass(decorations, line.from, `cm-heading-${level}`);
}

function decorateStrongEmphasis(decorations, atomicRanges, node, state) {
  const text = state.sliceDoc(node.from, node.to);
  const match = /^(\*\*|__)([\s\S]*)(\*\*|__)$/.exec(text);
  if (!match || match[1] !== match[3]) {
    return;
  }

  const delimiterLength = match[1].length;
  addReplacement(
    decorations,
    atomicRanges,
    node.from,
    node.from + delimiterLength,
  );
  addMark(
    decorations,
    node.from + delimiterLength,
    node.to - delimiterLength,
    "cm-strong",
  );
  addReplacement(
    decorations,
    atomicRanges,
    node.to - delimiterLength,
    node.to,
  );
}

function decorateEmphasis(decorations, atomicRanges, node, state) {
  const text = state.sliceDoc(node.from, node.to);
  const delimiter = text[0];
  if (!delimiter || delimiter !== text[text.length - 1] || !["*", "_"].includes(delimiter)) {
    return;
  }

  addReplacement(decorations, atomicRanges, node.from, node.from + 1);
  addMark(decorations, node.from + 1, node.to - 1, "cm-emphasis");
  addReplacement(decorations, atomicRanges, node.to - 1, node.to);
}

function decorateInlineCode(decorations, atomicRanges, node, state) {
  const text = state.sliceDoc(node.from, node.to);
  const match = /^(`+)([\s\S]*)(`+)$/.exec(text);
  if (!match || match[1] !== match[3]) {
    return;
  }

  const delimiterLength = match[1].length;
  addReplacement(
    decorations,
    atomicRanges,
    node.from,
    node.from + delimiterLength,
  );
  addMark(
    decorations,
    node.from + delimiterLength,
    node.to - delimiterLength,
    "cm-inline-code",
  );
  addReplacement(
    decorations,
    atomicRanges,
    node.to - delimiterLength,
    node.to,
  );
}

function decorateLink(decorations, atomicRanges, node, state) {
  const text = state.sliceDoc(node.from, node.to);
  const match = /^\[([\s\S]+)\]\(([\s\S]+)\)$/.exec(text);
  if (!match) {
    return;
  }

  const linkText = match[1];
  const url = normalizeLinkTarget(match[2]);
  const contentStart = node.from + 1;
  const contentEnd = contentStart + linkText.length;

  addReplacement(decorations, atomicRanges, node.from, contentStart);
  addMark(decorations, contentStart, contentEnd, "cm-link", {
    title: url,
    "data-link-target": url,
  });
  addReplacement(decorations, atomicRanges, contentEnd, node.to);
}

function decorateUrl(decorations, node, state) {
  if (hasAncestorNamed(node, "Link")) {
    return;
  }

  const text = state.sliceDoc(node.from, node.to);
  addMark(decorations, node.from, node.to, "cm-link", {
    title: normalizeLinkTarget(text),
    "data-link-target": normalizeLinkTarget(text),
  });
}

function decorateBareDomains(decorations, state, tree) {
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    bareDomainPattern.lastIndex = 0;
    for (const match of line.text.matchAll(bareDomainPattern)) {
      const matchedText = trimDetectedDomain(match[0]);
      if (!matchedText) {
        continue;
      }

      const matchStart = line.from + match.index;
      const matchEnd = matchStart + matchedText.length;
      if (!isBareDomainRenderable(tree, matchStart, matchEnd, line.text, match.index, matchedText.length)) {
        continue;
      }

      addMark(decorations, matchStart, matchEnd, "cm-link", {
        title: normalizeLinkTarget(matchedText),
        "data-link-target": normalizeLinkTarget(matchedText),
      });
    }
  }
}

function normalizeLinkTarget(text) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    return text;
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(text)) {
    return `mailto:${text}`;
  }

  return `https://${text}`;
}

function trimDetectedDomain(text) {
  return text.replace(/[),.;:!?]+$/g, "");
}

function isBareDomainRenderable(tree, from, to, lineText, matchIndex) {
  if (matchIndex > 0) {
    const before = lineText[matchIndex - 1];
    if (before === "@" || before === "/" || before === ":") {
      return false;
    }
  }

  for (let position = from; position < to; position += 1) {
    if (hasBlockedLineWidgetContext(tree, position) || hasLinkishContext(tree, position)) {
      return false;
    }
  }

  return true;
}

function hasLinkishContext(tree, position) {
  for (let node = tree.resolveInner(position, 1); node; node = node.parent) {
    if (node.name === "Link" || node.name === "URL" || node.name === "Autolink") {
      return true;
    }
  }
  return false;
}

function hasAncestorNamed(node, name) {
  for (let current = node.node.parent; current; current = current.parent) {
    if (current.name === name) {
      return true;
    }
  }
  return false;
}

function decorateListItem(
  decorations,
  atomicRanges,
  node,
  state,
  standardTaskLines,
  renderedListLines,
) {
  const listItem = node.node;
  const listMark = listItem.getChild("ListMark");
  if (!listMark) {
    return;
  }

  const line = state.doc.lineAt(node.from);
  renderedListLines.add(line.from);

  const taskMarker = listItem.getChild("Task")?.getChild("TaskMarker");
  if (taskMarker) {
    standardTaskLines.add(line.from);
    const checked = /x/i.test(state.sliceDoc(taskMarker.from, taskMarker.to));

    addReplacement(
      decorations,
      atomicRanges,
      listMark.from,
      taskMarker.from,
      { inclusive: false },
    );
    addReplacement(
      decorations,
      atomicRanges,
      taskMarker.from,
      taskMarker.to,
      {
        widget: new CheckboxWidget({
          checked,
          from: taskMarker.from,
          to: taskMarker.to,
          checkedText: "[x]",
          uncheckedText: "[ ]",
        }),
        inclusive: false,
      },
    );
    addMark(
      decorations,
      taskMarker.to,
      line.to,
      checked ? "cm-task-text cm-task-complete-text" : "cm-task-text",
    );
    return;
  }

  const text = line.text;
  const listMatch = /^(\s*)([-+*]|\d+[.)])(\s+)/.exec(text);
  if (!listMatch) {
    return;
  }

  const markerFrom = line.from + listMatch[1].length;
  const markerTo = markerFrom + listMatch[2].length + listMatch[3].length;
  addReplacement(
    decorations,
    atomicRanges,
    markerFrom,
    markerTo,
    { widget: new ListMarkerWidget(listMatch[2]), inclusive: false },
  );
}

function decorateBareTaskLines(
  decorations,
  atomicRanges,
  state,
  tree,
  standardTaskLines,
) {
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (standardTaskLines.has(line.from)) {
      continue;
    }

    const match = customTaskPattern.exec(line.text);
    if (!match) {
      continue;
    }

    const checkboxFrom = line.from + match[1].length;
    const checked = /x/i.test(match[2]);
    if (!isBareTaskRenderableLine(tree, checkboxFrom)) {
      continue;
    }

    addReplacement(
      decorations,
      atomicRanges,
      checkboxFrom,
      checkboxFrom + match[2].length,
      {
        widget: new CheckboxWidget({
          checked,
          from: checkboxFrom,
          to: checkboxFrom + match[2].length,
          checkedText: "[x]",
          uncheckedText: "[]",
        }),
        inclusive: false,
      },
    );
    addMark(
      decorations,
      checkboxFrom + match[2].length,
      line.to,
      checked ? "cm-task-text cm-task-complete-text" : "cm-task-text",
    );
  }
}

function decoratePendingListLines(
  decorations,
  atomicRanges,
  state,
  tree,
  renderedListLines,
) {
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (renderedListLines.has(line.from)) {
      continue;
    }

    const match = /^(\s*)([-+*]|\d+[.)])(\s*)$/.exec(line.text);
    if (!match) {
      continue;
    }

    const markerFrom = line.from + match[1].length;
    if (hasBlockedLineWidgetContext(tree, markerFrom)) {
      continue;
    }

    addReplacement(
      decorations,
      atomicRanges,
      markerFrom,
      line.to,
      { widget: new ListMarkerWidget(match[2]), inclusive: false },
    );
  }
}

function isBareTaskRenderableLine(tree, position) {
  return !hasBlockedLineWidgetContext(tree, position);
}

function hasBlockedLineWidgetContext(tree, position) {
  for (let node = tree.resolveInner(position, 1); node; node = node.parent) {
    if (blockedLineWidgetContexts.has(node.name)) {
      return true;
    }
  }
  return false;
}

function decorateBlockquote(decorations, atomicRanges, node, state) {
  const startLine = state.doc.lineAt(node.from).number;
  const endLine = state.doc.lineAt(node.to).number;

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const match = /^(\s*> ?)/.exec(line.text);
    if (match) {
      addReplacement(
        decorations,
        atomicRanges,
        line.from,
        line.from + match[1].length,
      );
    }
    addLineClass(decorations, line.from, "cm-blockquote-line");
  }
}

function decorateFencedCode(decorations, atomicRanges, node, state) {
  const firstLine = state.doc.lineAt(node.from);
  const lastLine = state.doc.lineAt(node.to);

  addReplacement(
    decorations,
    atomicRanges,
    firstLine.from,
    firstLine.to < state.doc.length ? firstLine.to + 1 : firstLine.to,
  );

  if (lastLine.number !== firstLine.number) {
    addReplacement(
      decorations,
      atomicRanges,
      lastLine.from,
      lastLine.to,
    );
  }

  for (let lineNumber = firstLine.number + 1; lineNumber < lastLine.number; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    addLineClass(decorations, line.from, "cm-code-block-line");
  }
}

function decorateHorizontalRule(decorations, atomicRanges, node, state) {
  const active = isCursorOnSyntaxNode(state, node);
  if (active) {
    addLineClass(decorations, node.from, "cm-horizontal-rule-active-line");
  }

  addReplacement(
    decorations,
    atomicRanges,
    node.from,
    node.to,
    {
      widget: new HorizontalRuleWidget(active),
      block: true,
    },
  );
}

class ListMarkerWidget extends WidgetType {
  constructor(marker) {
    super();
    this.marker = marker;
    this.ordered = /^\d/.test(marker);
  }

  eq(other) {
    return other.marker === this.marker;
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = this.ordered
      ? "cm-list-marker cm-list-marker-ordered"
      : "cm-list-marker cm-list-marker-bullet";
    if (this.ordered) {
      element.textContent = this.marker;
      element.style.color = "var(--link-color)";
    } else {
      const dot = document.createElement("span");
      dot.className = "cm-list-marker-bullet-dot";
      element.appendChild(dot);
    }
    return element;
  }
}

class CheckboxWidget extends WidgetType {
  constructor({ checked, from, to, checkedText, uncheckedText }) {
    super();
    this.checked = checked;
    this.from = from;
    this.to = to;
    this.checkedText = checkedText;
    this.uncheckedText = uncheckedText;
  }

  eq(other) {
    return (
      other.checked === this.checked &&
      other.from === this.from &&
      other.to === this.to &&
      other.checkedText === this.checkedText &&
      other.uncheckedText === this.uncheckedText
    );
  }

  ignoreEvent() {
    return false;
  }

  toDOM(view) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-checkbox";
    input.setAttribute("aria-label", this.checked ? "Checked task" : "Unchecked task");
    input.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    input.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const replacement = this.checked ? this.uncheckedText : this.checkedText;
      view.dispatch({
        changes: {
          from: this.from,
          to: this.to,
          insert: replacement,
        },
      });
      requestAnimationFrame(() => view.focus());
    });
    return input;
  }
}

class HorizontalRuleWidget extends WidgetType {
  constructor(active = false) {
    super();
    this.active = active;
  }

  eq(other) {
    return other.active === this.active;
  }

  toDOM() {
    const hr = document.createElement("hr");
    hr.className = this.active
      ? "cm-horizontal-rule cm-horizontal-rule-active"
      : "cm-horizontal-rule";
    return hr;
  }
}

function isCursorOnSyntaxNode(state, node) {
  const selection = state.selection.main;
  return (
    selection.empty &&
    selection.from >= node.from &&
    selection.from <= node.to
  );
}

function isCursorOnHorizontalRule(state) {
  const selection = state.selection.main;
  if (!selection.empty) {
    return false;
  }

  return !!findDirectHorizontalRuleNodeAt(state, selection.from);
}

function getDeleteRangeForLine(state, line) {
  let from = line.from;
  let to = line.to;

  if (line.to < state.doc.length) {
    to += 1;
  } else if (line.from > 0) {
    from -= 1;
  }

  return { from, to };
}

function findDirectHorizontalRuleNodeAt(state, position) {
  const tree = syntaxTree(state);
  const candidate = Math.max(0, Math.min(state.doc.length, position));

  for (const side of [-1, 1]) {
    for (let node = tree.resolveInner(candidate, side); node; node = node.parent) {
      if (node.name === "HorizontalRule") {
        return node;
      }
    }
  }

  return null;
}

function collectHorizontalRuleDeleteRanges(state, selection, preferNearby = false) {
  const ranges = [];
  const seenLines = new Set();

  const addLine = (line) => {
    if (!horizontalRulePattern.test(line.text) || seenLines.has(line.number)) {
      return;
    }
    seenLines.add(line.number);
    ranges.push(getDeleteRangeForLine(state, line));
  };

  const addNodeAt = (position) => {
    const node = findDirectHorizontalRuleNodeAt(state, position);
    if (node) {
      addLine(state.doc.lineAt(node.from));
    }
  };

  addNodeAt(selection.from);
  if (!selection.empty) {
    addNodeAt(selection.to);
    addNodeAt(Math.max(0, selection.from - 1));
    addNodeAt(Math.max(0, selection.to - 1));
  }

  const startLine = state.doc.lineAt(selection.from).number;
  const endPosition = selection.empty ? selection.to : Math.max(selection.from, selection.to - 1);
  const endLine = state.doc.lineAt(endPosition).number;

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    addLine(state.doc.line(lineNumber));
  }

  if (preferNearby && !ranges.length) {
    const currentLine = state.doc.lineAt(selection.from).number;
    for (const lineNumber of [currentLine - 1, currentLine, currentLine + 1]) {
      if (lineNumber >= 1 && lineNumber <= state.doc.lines) {
        addLine(state.doc.line(lineNumber));
      }
    }
  }

  return ranges;
}

function findHorizontalRuleDeleteRange(state, selection, preferNearby = false) {
  const ranges = collectHorizontalRuleDeleteRanges(state, selection, preferNearby);
  if (!ranges.length) {
    return null;
  }

  return {
    from: Math.min(selection.from, ...ranges.map((range) => range.from)),
    to: Math.max(selection.to, ...ranges.map((range) => range.to)),
  };
}

function toggleMarkdownWrap(delimiter) {
  return (view) => {
    const selection = view.state.selection.main;
    if (selection.empty) {
      return false;
    }

    const { from, to } = selection;
    const length = delimiter.length;
    const beforeFrom = Math.max(0, from - length);
    const afterTo = Math.min(view.state.doc.length, to + length);
    const before = view.state.sliceDoc(beforeFrom, from);
    const after = view.state.sliceDoc(to, afterTo);

    if (before === delimiter && after === delimiter) {
      view.dispatch({
        changes: [
          { from: beforeFrom, to: from, insert: "" },
          { from: to, to: afterTo, insert: "" },
        ],
        selection: EditorSelection.range(beforeFrom, afterTo - length * 2),
      });
      return true;
    }

    view.dispatch({
      changes: [
        { from, insert: delimiter },
        { from: to, insert: delimiter },
      ],
      selection: EditorSelection.range(from + length, to + length),
    });
    return true;
  };
}

function backspaceHeadingMarker(view) {
  if (currentMode !== "rendered") {
    return false;
  }

  const selection = view.state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const line = view.state.doc.lineAt(selection.from);
  const match = /^(#{1,6})(\s+)/.exec(line.text);
  if (!match) {
    return false;
  }

  const contentStart = line.from + match[0].length;
  if (selection.from !== contentStart) {
    return false;
  }

  view.dispatch({
    changes: { from: line.from, to: contentStart, insert: "" },
    selection: { anchor: line.from },
  });
  return true;
}

function backspaceHorizontalRule(view) {
  if (currentMode !== "rendered") {
    return false;
  }

  const selection = view.state.selection.main;
  const deleteRange = findHorizontalRuleDeleteRange(
    view.state,
    selection,
    view.dom.classList.contains("cm-on-horizontal-rule"),
  );
  if (!deleteRange) {
    return false;
  }

  view.dispatch({
    changes: { from: deleteRange.from, to: deleteRange.to, insert: "" },
    selection: EditorSelection.cursor(deleteRange.from),
  });
  return true;
}

function backspaceTaskMarker(view) {
  if (currentMode !== "rendered") {
    return false;
  }

  const selection = view.state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const line = view.state.doc.lineAt(selection.from);
  const standardTaskMatch = /^(\s*)([-+*]|\d+[.)])(\s+)(\[(?: |x|X)\])(\s+)/.exec(line.text);
  if (standardTaskMatch) {
    const deleteFrom =
      line.from +
      standardTaskMatch[1].length +
      standardTaskMatch[2].length +
      standardTaskMatch[3].length;
    const deleteTo =
      deleteFrom + standardTaskMatch[4].length + standardTaskMatch[5].length;

    if (selection.from > deleteFrom && selection.from <= deleteTo) {
      view.dispatch({
        changes: { from: deleteFrom, to: deleteTo, insert: "" },
        selection: EditorSelection.cursor(deleteFrom),
      });
      return true;
    }
  }

  const customTaskMatch = /^(\s*)(\[\]|\[(?:x|X)\])(\s+)/.exec(line.text);
  if (customTaskMatch) {
    const deleteFrom = line.from + customTaskMatch[1].length;
    const deleteTo =
      deleteFrom + customTaskMatch[2].length + customTaskMatch[3].length;

    if (selection.from > deleteFrom && selection.from <= deleteTo) {
      view.dispatch({
        changes: { from: deleteFrom, to: deleteTo, insert: "" },
        selection: EditorSelection.cursor(deleteFrom),
      });
      return true;
    }
  }

  return false;
}

function backspaceRenderedMarkup(view) {
  return (
    backspaceHorizontalRule(view) ||
    backspaceHeadingMarker(view) ||
    backspaceTaskMarker(view)
  );
}

function continueTaskOrListMarkup(view) {
  if (insertNewlineContinueMarkup(view)) {
    trimPendingListContinuation(view);
    return true;
  }

  const selection = view.state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const line = view.state.doc.lineAt(selection.from);
  if (selection.from !== line.to) {
    return false;
  }

  const match = /^(\s*)(\[\]|\[(?:x|X)\])(\s+)/.exec(line.text);
  if (!match) {
    return false;
  }

  const indent = match[1];
  const insert = `\n${indent}[] `;
  view.dispatch({
    changes: { from: selection.from, insert },
    selection: EditorSelection.cursor(selection.from + insert.length),
  });
  return true;
}

function trimPendingListContinuation(view) {
  if (currentMode !== "rendered") {
    return false;
  }

  const selection = view.state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const line = view.state.doc.lineAt(selection.from);
  if (!/^(\s*)([-+*]|\d+[.)]) $/.test(line.text)) {
    return false;
  }

  view.dispatch({
    changes: { from: line.to - 1, to: line.to, insert: "" },
    selection: EditorSelection.cursor(line.to - 1),
  });
  return true;
}

function selectedLines(state) {
  const startLine = state.doc.lineAt(state.selection.main.from).number;
  const endLine = state.doc.lineAt(state.selection.main.to).number;
  const lines = [];
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    lines.push(state.doc.line(lineNumber));
  }
  return lines;
}

function indentListSelection(view) {
  const lines = selectedLines(view.state);
  const changes = [];
  let touched = false;

  for (const line of lines) {
    if (/^(\s*)([-+*]|\d+[.)])\s+/.test(line.text) || /^\s+/.test(line.text)) {
      touched = true;
      changes.push({ from: line.from, insert: "  " });
    }
  }

  if (!touched) {
    return false;
  }

  view.dispatch({ changes });
  return true;
}

function outdentListSelection(view) {
  const lines = selectedLines(view.state);
  const changes = [];
  let touched = false;

  for (const line of lines) {
    const match = /^( {1,2}|\t)/.exec(line.text);
    if (match) {
      touched = true;
      changes.push({ from: line.from, to: line.from + match[0].length, insert: "" });
    }
  }

  if (!touched) {
    return false;
  }

  view.dispatch({ changes });
  return true;
}

function maybeAutoAdvanceHorizontalRule(update) {
  if (currentMode !== "rendered" || !update.docChanged) {
    return false;
  }

  if (update.transactions.some((transaction) =>
    transaction.annotation(fromSwiftAnnotation) ||
    transaction.annotation(autoAdvanceHorizontalRuleAnnotation))) {
    return false;
  }

  if (!update.transactions.some((transaction) => transaction.isUserEvent("input.type"))) {
    return false;
  }

  const selection = update.state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const line = update.state.doc.lineAt(selection.from);
  if (!horizontalRulePattern.test(line.text) || selection.from !== line.to) {
    return false;
  }

  if (line.number < update.state.doc.lines) {
    const nextLine = update.state.doc.line(line.number + 1);
    if (nextLine.text.length === 0) {
      update.view.dispatch({
        selection: EditorSelection.cursor(nextLine.from),
        annotations: autoAdvanceHorizontalRuleAnnotation.of(true),
      });
      return false;
    }
    return false;
  }

  update.view.dispatch({
    changes: { from: line.to, insert: "\n" },
    selection: EditorSelection.cursor(line.to + 1),
    annotations: autoAdvanceHorizontalRuleAnnotation.of(true),
  });
  return true;
}

const renderedDecorations = buildRenderedArtifactsField();
const rawLineNumbers = lineNumbers();
const rawActiveLineHighlights = [
  highlightActiveLine(),
  highlightActiveLineGutter(),
];

const rawTerminalScroll = ViewPlugin.fromClass(
  class {
    constructor() {
      this.pendingWheelLines = 0;
    }
  },
  {
    eventHandlers: {
      wheel(event, view) {
        if (currentMode !== "raw" || event.ctrlKey || !event.deltaY) {
          return false;
        }

        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
          return false;
        }

        const lineUnits = getWheelLineUnits(event, view);
        if (!lineUnits) {
          return false;
        }

        this.pendingWheelLines += lineUnits;

        const wholeLines = this.pendingWheelLines > 0
          ? Math.floor(this.pendingWheelLines)
          : Math.ceil(this.pendingWheelLines);

        event.preventDefault();

        if (!wholeLines) {
          return true;
        }

        this.pendingWheelLines -= wholeLines;

        if (!scrollRawViewByLines(view, wholeLines)) {
          this.pendingWheelLines = 0;
        }

        return true;
      },
    },
  },
);

const renderedLinkClicks = ViewPlugin.fromClass(
  class {},
  {
    eventHandlers: {
      click(event) {
        if (currentMode !== "rendered") {
          return false;
        }

        const clickedNode = event.target instanceof Node ? event.target : null;
        const target = clickedNode instanceof Element
          ? clickedNode.closest(".cm-link")
          : clickedNode?.parentElement?.closest(".cm-link");
        const url = target?.getAttribute("data-link-target");
        if (!url) {
          return false;
        }

        event.preventDefault();
        event.stopPropagation();
        safePostMessage("openLink", { url });
        return true;
      },
    },
  },
);

const renderedCursorState = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.sync();
    }

    update() {
      this.sync();
    }

    destroy() {
      this.view.dom.classList.remove("cm-on-horizontal-rule");
    }

    sync() {
      this.view.dom.classList.toggle(
        "cm-on-horizontal-rule",
        currentMode === "rendered" && isCursorOnHorizontalRule(this.view.state),
      );
    }
  },
);

const modeClassExtension = EditorView.editorAttributes.of({
  class: "cm-specter-rendered",
});

const rawModeClassExtension = EditorView.editorAttributes.of({
  class: "cm-specter-raw",
});

const readerWidthClassExtension = EditorView.editorAttributes.of({
  class: "cm-specter-reader-width",
});

const baseTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "inherit",
  },
  ".cm-content": {
    caretColor: "var(--caret-color)",
    padding: "0",
  },
  ".cm-line": {
    padding: "0",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-selectionBackground": {
    backgroundColor: "var(--selection-bg) !important",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--caret-color)",
  },
});

const renderedTheme = EditorView.theme({
  "&": {
    padding: "0",
  },
  ".cm-content": {
    caretColor: "var(--caret-color)",
  },
  ".cm-cursor": {
    backgroundColor: "var(--caret-color)",
    borderLeft: "none",
    width: "2px",
    marginLeft: "-1px",
    borderRadius: "999px",
  },
  ".cm-dropCursor": {
    borderLeft: "2px solid var(--caret-color)",
    marginLeft: "-1px",
    borderRadius: "999px",
  },
});

const rawTheme = EditorView.theme({
  "&": {
    padding: "0",
  },
});

const editorCommands = Prec.high(
  keymap.of([
    { key: "Enter", run: continueTaskOrListMarkup },
    { key: "Backspace", run: backspaceRenderedMarkup },
    { key: "Tab", run: indentListSelection, shift: indentMore },
    { key: "Shift-Tab", run: outdentListSelection, shift: indentLess },
    { key: "Mod-b", run: toggleMarkdownWrap("**") },
    { key: "Mod-i", run: toggleMarkdownWrap("*") },
    { key: "Mod-e", run: toggleMarkdownWrap("`") },
  ]),
);

const updateListener = EditorView.updateListener.of((update) => {
  if (!update.docChanged) {
    return;
  }

  if (maybeAutoAdvanceHorizontalRule(update)) {
    return;
  }

  if (update.transactions.some((transaction) => transaction.annotation(fromSwiftAnnotation))) {
    return;
  }

  safePostMessage("textChanged", update.state.doc.toString());
});

const parent = document.getElementById("editor");
if (!parent) {
  throw new Error("Editor mount node was not found.");
}

const view = new EditorView({
  state: EditorState.create({
    doc: "",
    extensions: [
      markdown({ extensions: [TaskList, Autolink, { remove: ["SetextHeading"] }] }),
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      baseTheme,
      editorCommands,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      decorationCompartment.of(renderedDecorations),
      themeCompartment.of(renderedTheme),
      modeClassCompartment.of(modeClassExtension),
      layoutClassCompartment.of([]),
      gutterCompartment.of([]),
      activeLineCompartment.of([]),
      scrollBehaviorCompartment.of([]),
      renderedCursorState,
      renderedLinkClicks,
      updateListener,
    ],
  }),
  parent,
});

function setMode(mode) {
  currentMode = mode === "raw" ? "raw" : "rendered";
  view.dispatch({
    effects: [
      decorationCompartment.reconfigure(
        currentMode === "rendered" ? renderedDecorations : [],
      ),
      themeCompartment.reconfigure(
        currentMode === "rendered" ? renderedTheme : rawTheme,
      ),
      modeClassCompartment.reconfigure(
        currentMode === "rendered" ? modeClassExtension : rawModeClassExtension,
      ),
      gutterCompartment.reconfigure(
        currentMode === "rendered" ? [] : rawLineNumbers,
      ),
      activeLineCompartment.reconfigure(
        currentMode === "rendered" ? [] : rawActiveLineHighlights,
      ),
      scrollBehaviorCompartment.reconfigure(
        currentMode === "rendered" ? [] : rawTerminalScroll,
      ),
    ],
  });
}

function setText(text) {
  const nextText = text ?? "";
  const currentText = view.state.doc.toString();
  if (nextText === currentText) {
    return;
  }

  const selection = view.state.selection.main;
  const anchor = Math.min(selection.anchor, nextText.length);
  const head = Math.min(selection.head, nextText.length);
  view.dispatch({
    annotations: fromSwiftAnnotation.of(true),
    changes: { from: 0, to: view.state.doc.length, insert: nextText },
    selection: EditorSelection.range(anchor, head),
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
  const light = document.getElementById("theme-light");
  const dark = document.getElementById("theme-dark");
  if (light instanceof HTMLLinkElement) {
    light.disabled = theme === "dark";
  }
  if (dark instanceof HTMLLinkElement) {
    dark.disabled = theme !== "dark";
  }
}

function setTextScale(scale) {
  const numericScale = Number(scale);
  const nextScale = Number.isFinite(numericScale) ? numericScale : 1;
  const clampedScale = Math.min(maximumTextScale, Math.max(minimumTextScale, nextScale));
  view.dom.style.setProperty("--specter-text-scale", String(clampedScale));
  view.requestMeasure();
}

function setReaderWidth(enabled) {
  view.dispatch({
    effects: layoutClassCompartment.reconfigure(
      enabled ? readerWidthClassExtension : [],
    ),
  });
}

globalThis.editor = {
  setText,
  getText() {
    return view.state.doc.toString();
  },
  setMode,
  setTheme,
  setTextScale,
  setReaderWidth,
  focus() {
    view.focus();
  },
};

safePostMessage("editorReady", { ok: true });
