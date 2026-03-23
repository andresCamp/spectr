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
import { Autolink, Table, TaskList } from "@lezer/markdown";
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
  "Table",
  "TableHeader",
  "TableRow",
  "TableDelimiter",
]);
const minimumTextScale = 11 / 15;
const maximumTextScale = 2;

// --- Content fingerprint visualization ---

function fnv1aHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseHexColor(hex) {
  hex = hex.trim().replace("#", "");
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  };
}

let activeFingerprintAnimation = null;

function drawContentFingerprint(canvas, text, animate) {
  // Cancel any running animation
  if (activeFingerprintAnimation) {
    cancelAnimationFrame(activeFingerprintAnimation);
    activeFingerprintAnimation = null;
  }

  const hash = fnv1aHash(text);
  const rng = mulberry32(hash);

  const dpr = globalThis.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;

  canvas.width = w * dpr;
  canvas.height = h * dpr;

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const trimHex = getComputedStyle(document.documentElement)
    .getPropertyValue("--trim-color")
    .trim();
  const { r, g, b } = parseHexColor(trimHex || "#e3bd96");
  const isDark = document.documentElement.dataset.theme === "dark";

  // Precompute tile data
  const tileSize = 10;
  const gap = 2;
  const step = tileSize + gap;
  const cols = Math.ceil(w / step);
  const rows = Math.ceil(h / step);
  const maxDiag = cols + rows - 2;
  const tiles = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const v = rng();
      if (v < 0.35) {
        rng(); // consume to keep sequence stable
        continue;
      }

      let fillStyle;
      if (v < 0.65) {
        const opacity = isDark
          ? 0.15 + rng() * 0.35
          : 0.12 + rng() * 0.30;
        fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
      } else {
        const opacity = isDark
          ? 0.06 + rng() * 0.12
          : 0.04 + rng() * 0.10;
        fillStyle = isDark
          ? `rgba(255, 255, 255, ${opacity})`
          : `rgba(0, 0, 0, ${opacity})`;
      }

      tiles.push({
        x: col * step,
        y: row * step,
        diag: col + row,
        fillStyle,
      });
    }
  }

  const fadeH = 24;

  function renderFrame(progress) {
    ctx.clearRect(0, 0, w, h);

    for (const tile of tiles) {
      // Each tile's local progress based on its diagonal position
      const tileDelay = tile.diag / maxDiag;
      const tileProgress = Math.max(0, Math.min(1, (progress - tileDelay * 0.6) / 0.4));
      if (tileProgress <= 0) continue;

      ctx.globalAlpha = tileProgress;
      ctx.fillStyle = tile.fillStyle;
      ctx.fillRect(tile.x, tile.y, tileSize, tileSize);
    }

    ctx.globalAlpha = 1;

    // Fade bottom edge
    const fadeGrad = ctx.createLinearGradient(0, h - fadeH, 0, h);
    fadeGrad.addColorStop(0, "rgba(0,0,0,0)");
    fadeGrad.addColorStop(1, "rgba(0,0,0,1)");
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = fadeGrad;
    ctx.fillRect(0, h - fadeH, w, fadeH);
    ctx.globalCompositeOperation = "source-over";
  }

  if (!animate) {
    renderFrame(1);
    return;
  }

  const duration = 600;
  const start = performance.now();

  function tick(now) {
    const elapsed = now - start;
    const t = Math.min(1, elapsed / duration);
    // Ease out cubic
    const progress = 1 - Math.pow(1 - t, 3);
    renderFrame(progress);
    if (t < 1) {
      activeFingerprintAnimation = requestAnimationFrame(tick);
    } else {
      activeFingerprintAnimation = null;
    }
  }

  activeFingerprintAnimation = requestAnimationFrame(tick);
}

let documentHeaderInstance = null;

const contentFingerprintPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.header = document.createElement("div");
      this.header.className = "cm-document-header";

      this.canvas = document.createElement("canvas");
      this.canvas.className = "cm-content-fingerprint";
      this.header.appendChild(this.canvas);

      this.meta = document.createElement("div");
      this.meta.className = "cm-document-meta";
      this.header.appendChild(this.meta);

      this.dateEl = document.createElement("span");
      this.dateEl.className = "cm-document-meta-item";
      this.dateLabelEl = document.createElement("span");
      this.dateLabelEl.className = "cm-document-meta-label";
      this.dateLabelEl.textContent = "Last edited";
      this.dateEl.appendChild(this.dateLabelEl);
      this.dateValueEl = document.createElement("span");
      this.dateEl.appendChild(this.dateValueEl);
      this.meta.appendChild(this.dateEl);

      this.pathEl = document.createElement("span");
      this.pathEl.className = "cm-document-meta-item";
      this.pathLabelEl = document.createElement("span");
      this.pathLabelEl.className = "cm-document-meta-label";
      this.pathLabelEl.textContent = "Path";
      this.pathEl.appendChild(this.pathLabelEl);
      this.pathValueEl = document.createElement("span");
      this.pathEl.appendChild(this.pathValueEl);
      this.meta.appendChild(this.pathEl);

      this.debounceTimer = null;
      this.hasDrawn = false;

      view.scrollDOM.insertBefore(this.header, view.scrollDOM.firstChild);

      this.resizeObserver = new ResizeObserver(() => {
        const animate = !this.hasDrawn;
        this.hasDrawn = true;
        this.draw(view.state.doc.toString(), animate);
      });
      this.resizeObserver.observe(this.canvas);

      documentHeaderInstance = this;
    }

    update(update) {
      if (update.docChanged) {
        clearTimeout(this.debounceTimer);
        const text = update.state.doc.toString();
        this.debounceTimer = setTimeout(() => this.draw(text, false), 800);
      }
    }

    draw(text, animate) {
      drawContentFingerprint(this.canvas, text, animate);
    }

    setFileInfo(path, lastModified) {
      this.pathValueEl.textContent = path || "";
      this.dateValueEl.textContent = lastModified || "";
    }

    destroy() {
      clearTimeout(this.debounceTimer);
      this.resizeObserver.disconnect();
      this.header.remove();
      if (documentHeaderInstance === this) {
        documentHeaderInstance = null;
      }
    }
  },
);

// --- End content fingerprint ---

function safePostMessage(name, body) {
  const handler = globalThis.webkit?.messageHandlers?.[name];
  if (!handler) {
    return;
  }
  handler.postMessage(body);
}

function reportError(message, extra = {}) {
  console.error("[Spectr Editor]", message, extra);
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
        case "Table":
          decorateTable(decorations, atomicRanges, node, state);
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

function getTopLineNumber(view) {
  const rect = view.contentDOM.getBoundingClientRect();
  const scrollerRect = view.scrollDOM.getBoundingClientRect();
  const docY = scrollerRect.top - rect.top;
  const block = view.lineBlockAtHeight(Math.max(0, docY));
  return view.state.doc.lineAt(block.from).number;
}

function scrollToLineNumber(view, lineNum) {
  const clamped = clamp(lineNum, 1, view.state.doc.lines);
  const line = view.state.doc.line(clamped);
  view.dispatch({
    effects: EditorView.scrollIntoView(line.from, { y: "start" }),
  });
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

function decorateTable(decorations, atomicRanges, node, state) {
  // Collect column alignments and delimiter row position from tree children.
  const alignments = [];
  let delimiterRowFrom = -1;
  let delimiterRowTo = -1;
  let columnCount = 0;
  const rows = []; // { from, to, lineNumber, isHeader, cells: [{ from, to }] }

  // First pass: walk direct children to gather structure.
  let child = node.node.firstChild;
  while (child) {
    if (child.name === "TableDelimiter" && child.from !== child.parent?.firstChild?.from) {
      // This is the separator row (not an inline pipe delimiter).
      // It spans an entire line when it's a direct child of Table.
      const line = state.doc.lineAt(child.from);
      if (line.from === child.from || line.text.trim().startsWith("|")) {
        delimiterRowFrom = line.from;
        delimiterRowTo = line.to;
        // Parse alignment from separator content.
        const sepText = state.doc.sliceString(child.from, child.to);
        const sepCells = sepText.split("|").filter(s => s.trim().length > 0);
        for (const cell of sepCells) {
          const trimmed = cell.trim();
          const left = trimmed.startsWith(":");
          const right = trimmed.endsWith(":");
          if (left && right) {
            alignments.push("center");
          } else if (right) {
            alignments.push("right");
          } else {
            alignments.push("left");
          }
        }
      }
    } else if (child.name === "TableHeader" || child.name === "TableRow") {
      const cells = [];
      let cellChild = child.firstChild;
      while (cellChild) {
        if (cellChild.name === "TableCell") {
          cells.push({ from: cellChild.from, to: cellChild.to });
        }
        cellChild = cellChild.nextSibling;
      }
      const line = state.doc.lineAt(child.from);
      rows.push({
        from: child.from,
        to: child.to,
        lineFrom: line.from,
        lineTo: line.to,
        lineNumber: line.number,
        isHeader: child.name === "TableHeader",
        cells,
      });
      if (cells.length > columnCount) {
        columnCount = cells.length;
      }
    }
    child = child.nextSibling;
  }

  if (rows.length === 0) {
    return;
  }

  const lastRowLineNumber = rows[rows.length - 1].lineNumber;

  // Hide the delimiter/separator row.
  if (delimiterRowFrom >= 0) {
    addReplacement(
      decorations,
      atomicRanges,
      delimiterRowFrom,
      delimiterRowTo < state.doc.length ? delimiterRowTo + 1 : delimiterRowTo,
    );
  }

  // Decorate each data/header row.
  const gridStyle = `grid-template-columns: repeat(${columnCount}, minmax(0, 1fr))`;
  for (const row of rows) {
    const line = state.doc.line(row.lineNumber);
    const isLastRow = row.lineNumber === lastRowLineNumber && !row.isHeader;
    const classes = ["cm-table-line"];
    classes.push(row.isHeader ? "cm-table-header" : "cm-table-row");
    if (isLastRow) {
      classes.push("cm-table-row-last");
    }

    // Single line decoration with class + grid style to avoid conflicts.
    decorations.push(
      Decoration.line({
        class: classes.join(" "),
        attributes: { style: gridStyle },
      }).range(line.from),
    );

    const text = line.text;

    // Hide leading pipe + whitespace.
    const firstPipe = text.indexOf("|");
    if (firstPipe >= 0 && text.substring(0, firstPipe).trim() === "") {
      let end = firstPipe + 1;
      while (end < text.length && text[end] === " ") {
        end += 1;
      }
      addReplacement(decorations, atomicRanges, line.from, line.from + end);
    }

    // Hide trailing pipe + whitespace.
    const lastPipe = text.lastIndexOf("|");
    if (lastPipe >= 0 && lastPipe > firstPipe && text.substring(lastPipe + 1).trim() === "") {
      let start = lastPipe;
      while (start > 0 && text[start - 1] === " ") {
        start -= 1;
      }
      // Guard against overlap with leading replacement.
      const leadingEnd = firstPipe >= 0 && text.substring(0, firstPipe).trim() === ""
        ? firstPipe + 1
        : 0;
      if (start < leadingEnd) {
        start = leadingEnd;
      }
      addReplacement(decorations, atomicRanges, line.from + start, line.from + text.length);
    }

    // Replace interior pipes with cell separator widgets.
    // Walk through cells — pipes sit between consecutive cells.
    for (let c = 0; c < row.cells.length - 1; c += 1) {
      const cellEnd = row.cells[c].to;
      const nextCellStart = row.cells[c + 1].from;
      // The pipe and surrounding whitespace lives between cellEnd and nextCellStart.
      // Find the pipe character in that gap.
      const gapText = state.doc.sliceString(cellEnd, nextCellStart);
      const pipeOffset = gapText.indexOf("|");
      if (pipeOffset >= 0) {
        // Replace the entire gap (whitespace + pipe + whitespace) with a separator widget.
        addReplacement(decorations, atomicRanges, cellEnd, nextCellStart, {
          widget: new TableCellSeparatorWidget(),
        });
      }
    }

    // Mark each cell with alignment class.
    for (let c = 0; c < row.cells.length; c += 1) {
      const cell = row.cells[c];
      const align = alignments[c] || "left";
      if (cell.from < cell.to) {
        addMark(decorations, cell.from, cell.to, `cm-table-cell cm-table-align-${align}`);
      }
    }
  }
}

class TableCellSeparatorWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-table-cell-sep";
    return element;
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

const scrollLineIndicator = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.hideTimer = 0;
      this.badge = document.createElement("div");
      this.badge.className = "cm-scroll-line-badge";
      this.badge.setAttribute("aria-hidden", "true");
      view.dom.appendChild(this.badge);
      this.onScroll = () => this.show();
      view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    }

    show() {
      const view = this.view;
      const lineNum = getTopLineNumber(view);

      this.badge.textContent = String(lineNum);

      const scroller = view.scrollDOM;
      const scrollFraction = scroller.scrollHeight > scroller.clientHeight
        ? scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight)
        : 0;
      const thumbHeight = scroller.clientHeight * (scroller.clientHeight / scroller.scrollHeight);
      const trackUsable = scroller.clientHeight - thumbHeight;
      const thumbCenter = thumbHeight / 2 + scrollFraction * trackUsable;

      this.badge.style.top = `${thumbCenter}px`;
      this.badge.style.transform = "translateY(-50%)";
      this.badge.classList.add("cm-scroll-line-badge-visible");

      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        this.badge.classList.remove("cm-scroll-line-badge-visible");
      }, 1200);
    }

    destroy() {
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
      clearTimeout(this.hideTimer);
      this.badge.remove();
    }
  },
);

const scrollOffsetReporter = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.lastReported = -1;
      this.onScroll = () => {
        const top = view.scrollDOM.scrollTop;
        const scrolled = top > 2;
        const flag = scrolled ? 1 : 0;
        if (flag !== this.lastReported) {
          this.lastReported = flag;
          safePostMessage("scrollAtTop", !scrolled);
        }
      };
      view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      // Report initial state
      requestAnimationFrame(() => this.onScroll());
    }

    destroy() {
      // cleanup handled by CM
    }
  },
);

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
  class { },
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
  class: "cm-spectr-rendered",
});

const rawModeClassExtension = EditorView.editorAttributes.of({
  class: "cm-spectr-raw",
});

const readerWidthClassExtension = EditorView.editorAttributes.of({
  class: "cm-spectr-reader-width",
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
      markdown({ extensions: [TaskList, Autolink, Table, { remove: ["SetextHeading"] }] }),
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
      contentFingerprintPlugin,
      scrollOffsetReporter,
      scrollLineIndicator,
      renderedCursorState,
      renderedLinkClicks,
      updateListener,
    ],
  }),
  parent,
});

let hasSetModeOnce = false;

function setMode(mode) {
  const isInitial = !hasSetModeOnce;
  hasSetModeOnce = true;

  const topLine = getTopLineNumber(view);
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

  if (!isInitial) {
    // Restore scroll position only on mode transitions, not initial setup
    requestAnimationFrame(() => scrollToLineNumber(view, topLine));
  }
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

function scrollToTop() {
  view.scrollDOM.scrollTop = 0;
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
  view.dom.style.setProperty("--spectr-text-scale", String(clampedScale));
  view.requestMeasure();
}

function setReaderWidth(enabled) {
  view.dispatch({
    effects: layoutClassCompartment.reconfigure(
      enabled ? readerWidthClassExtension : [],
    ),
  });
}

function setFileInfo(path, lastModified) {
  if (documentHeaderInstance) {
    documentHeaderInstance.setFileInfo(path, lastModified);
  }
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
  setFileInfo,
  scrollToTop,
  focus() {
    view.focus();
  },
};

safePostMessage("editorReady", { ok: true });
