/**
 * The writing surface is one rendered page. Markup stays in the document
 * string; the DOM shows ruby. These helpers map between the two.
 */

import { formatRubyMarkup } from "./rubyEdit";
import { isNl, parse, readCp } from "./parser";
import type { InsertResult } from "./rubyEdit";

const BSLASH = 0x5c;

export type PageNode =
  | { kind: "text"; text: string }
  | { kind: "br" }
  | { kind: "mark"; id: string }
  | { kind: "ruby"; base: string; reading: string }
  | { kind: "block"; children: PageNode[] };

export interface Piece {
  kind: "text" | "ruby";
  text: string;
  base: string;
  reading: string;
  start: number;
  end: number;
}

export interface LineLayout {
  start: number;
  pieces: Piece[];
  breakLen: number;
}

export function escapePlain(text: string): string {
  return text.replace(/[\\｜|《》{}]/g, (ch) => `\\${ch}`);
}

export function layoutSource(text: string): LineLayout[] {
  const lines: LineLayout[] = [{ start: 0, pieces: [], breakLen: 0 }];
  const current = () => lines[lines.length - 1];
  const pushText = (rendered: string, start: number, end: number) => {
    if (end <= start) return;
    const line = current();
    const last = line.pieces[line.pieces.length - 1];
    if (last && last.kind === "text" && last.end === start) {
      last.text += rendered;
      last.end = end;
      return;
    }
    line.pieces.push({ kind: "text", text: rendered, base: "", reading: "", start, end });
  };
  const newline = (at: number, len: number) => {
    current().breakLen = len;
    lines.push({ start: at + len, pieces: [], breakLen: 0 });
  };

  for (const seg of parse(text)) {
    if (seg.type === "ruby") {
      current().pieces.push({
        kind: "ruby",
        text: seg.base,
        base: seg.base,
        reading: seg.reading,
        start: seg.start,
        end: seg.end,
      });
      continue;
    }
    let i = seg.start;
    let buf = "";
    let bufStart = i;
    const flush = (end: number) => {
      if (buf) pushText(buf, bufStart, end);
      buf = "";
    };
    while (i < seg.end) {
      const c = readCp(text, i)!;
      if (isNl(c.cp)) {
        flush(i);
        const len = c.cp === 0x0d && text.charCodeAt(i + 1) === 0x0a ? 2 : 1;
        newline(i, len);
        i += len;
        bufStart = i;
        continue;
      }
      if (c.cp === BSLASH) {
        const n = readCp(text, c.next);
        if (n && !isNl(n.cp)) {
          if (!buf) bufStart = i;
          buf += String.fromCodePoint(n.cp);
          i = n.next;
          continue;
        }
      }
      if (!buf) bufStart = i;
      buf += String.fromCodePoint(c.cp);
      i = c.next;
    }
    flush(i);
  }
  return lines;
}

export function markupToPage(text: string): PageNode[] {
  return layoutSource(text).map((line) => ({
    kind: "block",
    children:
      line.pieces.length === 0
        ? [{ kind: "br" }]
        : line.pieces.map((piece) =>
            piece.kind === "ruby"
              ? { kind: "ruby" as const, base: piece.base, reading: piece.reading }
              : { kind: "text" as const, text: piece.text },
          ),
  }));
}

function writeInline(nodes: PageNode[], marks: Record<string, number>, into: { text: string }) {
  for (const node of nodes) {
    if (node.kind === "mark") marks[node.id] = into.text.length;
    else if (node.kind === "text") into.text += escapePlain(node.text);
    else if (node.kind === "br") into.text += "\n";
    else if (node.kind === "ruby") {
      if (node.base) into.text += formatRubyMarkup(node.base, node.reading);
      else if (node.reading) into.text += escapePlain(node.reading);
    } else writeInline(node.children, marks, into);
  }
}

function blockBody(children: PageNode[], marks: Record<string, number>): string {
  const significant = children.filter((node) => node.kind !== "mark");
  if (significant.length === 0 || (significant.length === 1 && significant[0].kind === "br")) {
    for (const node of children) if (node.kind === "mark") marks[node.id] = 0;
    return "";
  }
  const into = { text: "" };
  writeInline(children, marks, into);
  return into.text;
}

/** Turn a page tree back into markup. Marks record source offsets. */
export function serializePage(nodes: PageNode[]): { text: string; marks: Record<string, number> } {
  const marks: Record<string, number> = {};
  if (!nodes.some((node) => node.kind === "block")) {
    const into = { text: "" };
    writeInline(nodes, marks, into);
    return { text: into.text, marks };
  }
  const parts: string[] = [];
  let pending: string[] = [];
  const commit = (part: string, local: Record<string, number>) => {
    const base = parts.length === 0 ? 0 : parts.join("\n").length + 1;
    for (const id of pending) marks[id] = base;
    pending = [];
    for (const [id, at] of Object.entries(local)) marks[id] = base + at;
    parts.push(part);
  };
  for (const node of nodes) {
    if (node.kind === "mark") {
      pending.push(node.id);
      continue;
    }
    if (node.kind === "block") {
      const local: Record<string, number> = {};
      commit(blockBody(node.children, local), local);
      continue;
    }
    const local: Record<string, number> = {};
    const into = { text: "" };
    writeInline([node], local, into);
    commit(into.text, local);
  }
  if (pending.length) {
    const end = parts.join("\n").length;
    for (const id of pending) marks[id] = end;
  }
  return { text: parts.join("\n"), marks };
}

/** How far into `slice` (a source fragment) a rendered-character offset lands. */
export function sourceIndexForRendered(slice: string, rendered: number): number {
  let i = 0;
  let seen = 0;
  while (i < slice.length && seen < rendered) {
    const c = readCp(slice, i)!;
    if (c.cp === BSLASH) {
      const n = readCp(slice, c.next);
      if (n && !isNl(n.cp)) {
        seen += String.fromCodePoint(n.cp).length;
        i = n.next;
        continue;
      }
    }
    seen += String.fromCodePoint(c.cp).length;
    i = c.next;
  }
  return i;
}

/** Rendered index in `slice` for a source offset, snapping out of an escape. */
export function renderedIndexForSource(slice: string, sourceIndex: number): number {
  let i = 0;
  let rendered = 0;
  while (i < slice.length && i < sourceIndex) {
    const c = readCp(slice, i)!;
    let next = c.next;
    let add = String.fromCodePoint(c.cp).length;
    if (c.cp === BSLASH) {
      const n = readCp(slice, c.next);
      if (n && !isNl(n.cp)) {
        next = n.next;
        add = String.fromCodePoint(n.cp).length;
      }
    }
    if (i < sourceIndex && next > sourceIndex) return rendered;
    i = next;
    rendered += add;
  }
  return rendered;
}

export function applyReading(text: string, start: number, end: number, base: string, reading: string): InsertResult {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  if (from === to || !base) return { ok: false, reason: "empty-selection" };
  if (base.includes("\n") || base.includes("\r") || text.slice(from, to).includes("\n") || text.slice(from, to).includes("\r")) {
    return { ok: false, reason: "multiline" };
  }
  const trimmed = reading.trim();
  if (!trimmed) return { ok: false, reason: "empty-reading" };
  const markup = formatRubyMarkup(base, trimmed);
  return {
    ok: true,
    text: text.slice(0, from) + markup + text.slice(to),
    cursor: from + markup.length,
    markup,
  };
}

export function visibleCharCount(text: string): number {
  let visible = "";
  for (const seg of parse(text)) {
    visible += seg.type === "ruby" ? seg.base : seg.text.replace(/\r\n/g, "").replace(/[\r\n]/g, "");
  }
  return Array.from(visible).length;
}

const BLOCKS = new Set(["DIV", "P"]);

function baseText(el: HTMLElement): string {
  let out = "";
  for (const kid of el.childNodes) {
    if (kid.nodeType === Node.TEXT_NODE) out += kid.textContent ?? "";
    else if (kid instanceof HTMLElement && kid.tagName !== "RT" && kid.tagName !== "RP") out += baseText(kid);
  }
  return out;
}

function textNodeToPage(node: Text, range: Range | null): PageNode[] {
  const text = node.textContent ?? "";
  const cuts: { at: number; id: string }[] = [];
  if (range && range.startContainer === node) cuts.push({ at: Math.min(range.startOffset, text.length), id: "start" });
  if (range && range.endContainer === node) cuts.push({ at: Math.min(range.endOffset, text.length), id: "end" });
  if (cuts.length === 0) return text ? [{ kind: "text", text }] : [];
  cuts.sort((a, b) => a.at - b.at || (a.id === "start" ? -1 : 1));
  const out: PageNode[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.at > cursor) out.push({ kind: "text", text: text.slice(cursor, cut.at) });
    out.push({ kind: "mark", id: cut.id });
    cursor = cut.at;
  }
  if (cursor < text.length) out.push({ kind: "text", text: text.slice(cursor) });
  return out;
}

function childrenToPage(parent: Node, range: Range | null): PageNode[] {
  const out: PageNode[] = [];
  const kids = [...parent.childNodes];
  const markAt = (index: number) => {
    if (!range) return;
    if (range.startContainer === parent && range.startOffset === index) out.push({ kind: "mark", id: "start" });
    if (range.endContainer === parent && range.endOffset === index) out.push({ kind: "mark", id: "end" });
  };
  kids.forEach((kid, index) => {
    markAt(index);
    out.push(...nodeToPage(kid, range));
  });
  markAt(kids.length);
  return out;
}

function nodeToPage(node: Node, range: Range | null): PageNode[] {
  if (node.nodeType === Node.TEXT_NODE) return textNodeToPage(node as Text, range);
  if (!(node instanceof HTMLElement)) return [];
  if (node.tagName === "RT" || node.tagName === "RP") return [];
  if (node.tagName === "BR") return [{ kind: "br" }];
  if (node.tagName === "RUBY") {
    const ruby = { kind: "ruby" as const, base: baseText(node), reading: node.querySelector("rt")?.textContent ?? "" };
    const startIn = !!range && node.contains(range.startContainer);
    const endIn = !!range && node.contains(range.endContainer);
    if (startIn && endIn) return [{ kind: "mark", id: "start" }, ruby, { kind: "mark", id: "end" }];
    if (startIn) return [{ kind: "mark", id: "start" }, ruby];
    if (endIn) return [ruby, { kind: "mark", id: "end" }];
    return [ruby];
  }
  if (BLOCKS.has(node.tagName)) return [{ kind: "block", children: childrenToPage(node, range) }];
  return childrenToPage(node, range);
}

export function domToPage(root: Node, range: Range | null): PageNode[] {
  return childrenToPage(root, range);
}

export function visibleText(range: Range): string {
  const frag = range.cloneContents();
  frag.querySelectorAll("rt, rp").forEach((node) => node.remove());
  return (frag.textContent ?? "").replace(/\u200b/g, "");
}

export function expandRangeToRubies(root: HTMLElement, range: Range): Range {
  const next = range.cloneRange();
  for (const ruby of root.querySelectorAll("ruby")) {
    if (!next.intersectsNode(ruby)) continue;
    const whole = document.createRange();
    whole.selectNode(ruby);
    if (next.compareBoundaryPoints(Range.START_TO_START, whole) > 0) next.setStartBefore(ruby);
    if (next.compareBoundaryPoints(Range.END_TO_END, whole) < 0) next.setEndAfter(ruby);
  }
  return next;
}

function renderedOffset(span: HTMLElement, container: Node, offset: number): number {
  let seen = 0;
  for (const kid of span.childNodes) {
    if (kid === container) return seen + offset;
    if (kid.nodeType === Node.TEXT_NODE) seen += kid.textContent?.length ?? 0;
    else if (kid instanceof HTMLElement && kid.tagName !== "BR") seen += kid.textContent?.length ?? 0;
  }
  return seen;
}

function pointToSource(container: Node, offset: number, state: string): number {
  if (container.nodeType === Node.TEXT_NODE) {
    const parent = container.parentElement;
    if (!parent) return 0;
    if (parent.closest("rt, rp")) {
      const ruby = parent.closest("ruby");
      return ruby?.dataset.start ? Number(ruby.dataset.start) : 0;
    }
    const ruby = parent.closest("ruby");
    if (ruby?.dataset.start) return Number(ruby.dataset.start);
    const span = parent.closest("span[data-start]");
    if (span instanceof HTMLElement && span.dataset.start && span.dataset.end) {
      const start = Number(span.dataset.start);
      const end = Number(span.dataset.end);
      const rendered = renderedOffset(span, container, offset);
      return start + sourceIndexForRendered(state.slice(start, end), rendered);
    }
  }
  if (container instanceof HTMLElement) {
    const kids = [...container.childNodes];
    if (offset < kids.length) return startOf(kids[offset], state);
    if (kids.length === 0) return Number(container.dataset.start ?? 0);
    return endAfter(kids[kids.length - 1], state);
  }
  return 0;
}

function startOf(node: Node, state: string): number {
  if (node instanceof HTMLElement && node.dataset.start) return Number(node.dataset.start);
  if (node instanceof HTMLElement && node.tagName === "BR") return Number(node.parentElement?.dataset.start ?? 0);
  if (node.nodeType === Node.TEXT_NODE) return pointToSource(node, 0, state);
  if (node instanceof HTMLElement && node.firstChild) return startOf(node.firstChild, state);
  return 0;
}

function endAfter(node: Node, state: string): number {
  if (node instanceof HTMLElement && node.dataset.end) return Number(node.dataset.end);
  if (node instanceof HTMLElement && node.tagName === "BR") return Number(node.parentElement?.dataset.start ?? 0);
  if (node.nodeType === Node.TEXT_NODE) return pointToSource(node, node.textContent?.length ?? 0, state);
  if (node instanceof HTMLElement && node.lastChild) return endAfter(node.lastChild, state);
  return state.length;
}

function selectionFromDataset(root: HTMLElement, state: string, range: Range): { start: number; end: number; base: string } {
  const expanded = range.collapsed ? range : expandRangeToRubies(root, range);
  const start = pointToSource(expanded.startContainer, expanded.startOffset, state);
  const end = pointToSource(expanded.endContainer, expanded.endOffset, state);
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  return { start: from, end: to, base: range.collapsed ? "" : visibleText(expanded) };
}

export interface SourceSelection {
  start: number;
  end: number;
  base: string;
}

/** Source offsets for the current selection. Collapsed selections have an empty base. */
export function sourceSelection(root: HTMLElement, state: string): SourceSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !root.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  const serialized = serializePage(domToPage(root, null)).text;
  if (serialized !== state) return selectionFromDataset(root, state, range);
  const expanded = range.collapsed ? range : expandRangeToRubies(root, range);
  const { marks } = serializePage(domToPage(root, expanded));
  if (marks.start == null || marks.end == null) return selectionFromDataset(root, state, range);
  const start = Math.min(marks.start, marks.end);
  const end = Math.max(marks.start, marks.end);
  return { start, end, base: range.collapsed ? "" : visibleText(expanded) };
}

export function paintPage(root: HTMLElement, text: string) {
  root.replaceChildren();
  for (const line of layoutSource(text)) {
    const div = document.createElement("div");
    div.dataset.start = String(line.start);
    if (line.pieces.length === 0) div.append(document.createElement("br"));
    for (const piece of line.pieces) {
      if (piece.kind === "ruby") {
        const ruby = document.createElement("ruby");
        ruby.dataset.start = String(piece.start);
        ruby.dataset.end = String(piece.end);
        ruby.append(document.createTextNode(piece.base));
        const rt = document.createElement("rt");
        rt.textContent = piece.reading;
        ruby.append(rt);
        div.append(ruby);
      } else {
        const span = document.createElement("span");
        span.dataset.start = String(piece.start);
        span.dataset.end = String(piece.end);
        span.append(document.createTextNode(piece.text));
        div.append(span);
      }
    }
    root.append(div);
  }
}

function indexOfNode(node: Node): number {
  const parent = node.parentNode;
  if (!parent) return 0;
  return [...parent.childNodes].indexOf(node as ChildNode);
}

export function selectSourceOffsets(root: HTMLElement, state: string, start: number, end: number) {
  const range = document.createRange();
  const ruby = [...root.querySelectorAll("ruby")].find(
    (item) => Number(item.dataset.start) === Math.min(start, end) && Number(item.dataset.end) === Math.max(start, end),
  );
  if (ruby && start !== end) {
    const text = [...ruby.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (text) {
      range.setStart(text, 0);
      range.setEnd(text, text.textContent?.length ?? 0);
    } else range.selectNode(ruby);
  } else {
    const a = locate(root, state, start);
    const b = locate(root, state, end);
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function locate(root: HTMLElement, state: string, target: number): { node: Node; offset: number } {
  for (const el of root.querySelectorAll("span[data-start], ruby")) {
    if (!(el instanceof HTMLElement) || el.dataset.start == null) continue;
    const from = Number(el.dataset.start);
    const to = Number(el.dataset.end ?? el.dataset.start);
    if (target < from || target > to) continue;
    if (el.tagName === "RUBY") {
      const at = target === from ? indexOfNode(el) : indexOfNode(el) + 1;
      return { node: el.parentNode!, offset: at };
    }
    const text = [...el.childNodes].find((node) => node.nodeType === Node.TEXT_NODE) ?? el;
    const rendered = renderedIndexForSource(state.slice(from, to), target - from);
    if (text.nodeType === Node.TEXT_NODE) return { node: text, offset: Math.min(rendered, text.textContent?.length ?? 0) };
    return { node: el, offset: 0 };
  }
  const lines = [...root.children] as HTMLElement[];
  for (const line of lines) {
    if (Number(line.dataset.start ?? -1) === target) return { node: line, offset: 0 };
  }
  const last = root.lastChild ?? root;
  if (last instanceof HTMLElement) return { node: last, offset: last.childNodes.length };
  return { node: root, offset: root.childNodes.length };
}

/** Highlight the nth ruby on the page. Order matches the markup. */
export function selectRubyAt(root: HTMLElement, index: number) {
  const ruby = root.querySelectorAll("ruby")[index];
  if (!ruby) return;
  const text = [...ruby.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
  const range = document.createRange();
  if (text) {
    range.setStart(text, 0);
    range.setEnd(text, text.textContent?.length ?? 0);
  } else range.selectNode(ruby);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  root.focus();
}
