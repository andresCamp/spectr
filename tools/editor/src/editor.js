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
  WidgetType,
  drawSelection,
  keymap,
} from "@codemirror/view";
import {
  insertNewlineContinueMarkup,
  markdown,
} from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands";

const fromSwiftAnnotation = Annotation.define();
const decorationCompartment = new Compartment();
const themeCompartment = new Compartment();
const modeClassCompartment = new Compartment();

let currentMode = "rendered";

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
      if (!transaction.docChanged) {
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

  syntaxTree(state).iterate({
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
        case "ListItem":
          decorateListItem(decorations, atomicRanges, node, state);
          break;
        case "Blockquote":
          decorateBlockquote(decorations, atomicRanges, node, state);
          break;
        case "FencedCode":
          decorateFencedCode(decorations, atomicRanges, node, state);
          break;
        case "HorizontalRule":
          decorateHorizontalRule(decorations, atomicRanges, node);
          break;
        default:
          break;
      }
    },
  });

  return {
    decorations: Decoration.set(decorations, true),
    atomicRanges: Decoration.set(atomicRanges, true),
  };
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

  addMark(decorations, prefixEnd, contentEnd, `cm-heading-${level}`);
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
  const url = match[2];
  const contentStart = node.from + 1;
  const contentEnd = contentStart + linkText.length;

  addReplacement(decorations, atomicRanges, node.from, contentStart);
  addMark(decorations, contentStart, contentEnd, "cm-link", { title: url });
  addReplacement(decorations, atomicRanges, contentEnd, node.to);
}

function decorateListItem(decorations, atomicRanges, node, state) {
  const line = state.doc.lineAt(node.from);
  const text = line.text;
  const taskMatch = /^(\s*)([-+*]|\d+[.)])(\s+)(\[(?: |x|X)\])(\s+)/.exec(text);
  if (taskMatch) {
    const markerFrom = line.from + taskMatch[1].length;
    const markerTo = markerFrom + taskMatch[2].length + taskMatch[3].length;
    const checkboxFrom = markerTo;
    const checkboxTo = checkboxFrom + taskMatch[4].length;
    const checked = /x/i.test(taskMatch[4]);
    const markerText = taskMatch[2];

    addReplacement(
      decorations,
      atomicRanges,
      markerFrom,
      markerTo,
      { widget: new ListMarkerWidget(markerText), inclusive: false },
    );
    addReplacement(
      decorations,
      atomicRanges,
      checkboxFrom,
      checkboxTo,
      {
        widget: new CheckboxWidget(checked, checkboxFrom),
        inclusive: false,
      },
    );
    return;
  }

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

function decorateHorizontalRule(decorations, atomicRanges, node) {
  addReplacement(
    decorations,
    atomicRanges,
    node.from,
    node.to,
    {
      widget: new HorizontalRuleWidget(),
      block: true,
    },
  );
}

class ListMarkerWidget extends WidgetType {
  constructor(marker) {
    super();
    this.marker = marker;
  }

  eq(other) {
    return other.marker === this.marker;
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-list-marker";
    element.textContent = /^\d/.test(this.marker) ? this.marker : "\u2022";
    return element;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(checked, position) {
    super();
    this.checked = checked;
    this.position = position;
  }

  eq(other) {
    return other.checked === this.checked && other.position === this.position;
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
      const replacement = this.checked ? "[ ]" : "[x]";
      view.dispatch({
        changes: {
          from: this.position,
          to: this.position + 3,
          insert: replacement,
        },
      });
      requestAnimationFrame(() => view.focus());
    });
    return input;
  }
}

class HorizontalRuleWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const hr = document.createElement("hr");
    hr.className = "cm-horizontal-rule";
    return hr;
  }
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

const renderedDecorations = buildRenderedArtifactsField();

const modeClassExtension = EditorView.editorAttributes.of({
  class: "cm-specter-rendered",
});

const rawModeClassExtension = EditorView.editorAttributes.of({
  class: "cm-specter-raw",
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
    caretColor: "var(--text-primary)",
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
  ".cm-cursor": {
    borderLeftColor: "var(--text-primary)",
  },
});

const renderedTheme = EditorView.theme({
  "&": {
    padding: "0",
  },
});

const rawTheme = EditorView.theme({
  "&": {
    padding: "0",
  },
});

const editorCommands = Prec.high(
  keymap.of([
    { key: "Enter", run: insertNewlineContinueMarkup },
    { key: "Backspace", run: backspaceHeadingMarker },
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
      markdown(),
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      baseTheme,
      editorCommands,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      decorationCompartment.of(renderedDecorations),
      themeCompartment.of(renderedTheme),
      modeClassCompartment.of(modeClassExtension),
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

globalThis.editor = {
  setText,
  getText() {
    return view.state.doc.toString();
  },
  setMode,
  setTheme,
  focus() {
    view.focus();
  },
};

safePostMessage("editorReady", { ok: true });
