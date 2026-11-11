/**
 * Source lines <-> DOM. Each source line is one `.ln` element: a `div`, or a
 * `tr` inside a `table` for consecutive table rows. A line element remembers
 * the source it was painted from until it is edited, so untouched lines go
 * back to disk byte for byte.
 */

import {
  escapeText,
  formatRubyMarkup,
  parseInline,
  parseLine,
  splitCells,
  visible,
  type Inline,
  type Line,
} from "../lib/parser";
import { cachedReadings, type Reading } from "../lib/furigana";

/** Painted (or last serialized) source of a line element. Deleted when the element is edited. */
export const clean = new WeakMap<Element, string>();

export function decorate(el: HTMLElement, line: Line) {
  el.dataset.pre = line.pre;
  el.className = `ln ${line.kind}`;
  el.style.paddingLeft = line.indent ? `${line.indent}em` : "";
  if (line.kind.startsWith("h")) {
    el.setAttribute("role", "heading");
    el.setAttribute("aria-level", line.kind.slice(1));
  } else {
    el.removeAttribute("role");
    el.removeAttribute("aria-level");
  }
}

/** Puts automatic readings over plain text; tracks the visible offset across nested items. */
interface Furi {
  readings: Reading[];
  at: number;
}

function rubyEl(base: string, reading: string): HTMLElement {
  const ruby = document.createElement("ruby");
  ruby.append(base);
  const rt = document.createElement("rt");
  rt.contentEditable = "false";
  // Drawn by CSS, so the reading is not text the caret or a selection can step through.
  rt.dataset.r = reading;
  ruby.append(rt);
  return ruby;
}

function text(s: string, into: Node, furi: Furi) {
  const from = furi.at;
  furi.at += s.length;
  let cut = 0;
  for (const [a, b, r] of furi.readings) {
    if (a < from + cut || b > furi.at) continue;
    if (a > from + cut) into.appendChild(document.createTextNode(s.slice(cut, a - from)));
    const ruby = rubyEl(s.slice(a - from, b - from), r);
    ruby.dataset.auto = "";
    into.appendChild(ruby);
    cut = b - from;
  }
  if (cut < s.length) into.appendChild(document.createTextNode(s.slice(cut)));
}

function inline(items: Inline[], into: Node, furi: Furi) {
  for (const it of items) {
    if (it.t === "text") {
      text(it.s, into, furi);
    } else if (it.t === "ruby") {
      const ruby = rubyEl(it.base, it.reading);
      ruby.dataset.raw = it.raw;
      ruby.dataset.base = it.base;
      ruby.dataset.reading = it.reading;
      into.appendChild(ruby);
      furi.at += it.base.length;
    } else if (it.t === "note") {
      const span = document.createElement("span");
      span.className = "nt";
      span.dataset.raw = it.raw;
      into.appendChild(span);
    } else {
      const el = document.createElement(it.t === "az" ? "span" : it.t);
      if (it.t === "az") {
        el.className = it.cls;
        el.dataset.az = "";
      }
      inline(it.kids, el, furi);
      into.appendChild(el);
    }
  }
}

/** Paint parsed items; reports the visible text when its readings are not cached yet. */
function body(items: Inline[], into: HTMLElement, want: (key: string) => void) {
  const key = visible(items);
  const readings = cachedReadings(key);
  if (readings === undefined) want(key);
  inline(items, into, { readings: readings ?? [], at: 0 });
}

function fill(el: HTMLElement) {
  if (!el.firstChild || (el.lastChild instanceof HTMLElement && el.lastChild.className === "nt")) el.append(document.createElement("br"));
}

/** Visible texts of a line that furigana is computed for (one per table cell). */
export function lineKeys(src: string): string[] {
  const line = parseLine(src);
  if (line.kind === "row") return splitCells(line.body).map((c) => visible(parseInline(c.src)));
  return [visible(parseInline(line.body))];
}

/** One line element: a `div`, or a `tr` for a table row. */
export function paintLine(src: string, hidden: boolean, want: (key: string) => void): HTMLElement {
  const line = parseLine(src);
  if (line.kind === "row" && !hidden) {
    const tr = document.createElement("tr");
    tr.className = "ln row";
    tr.dataset.pre = line.pre;
    for (const cell of splitCells(line.body)) {
      const td = document.createElement("td");
      td.dataset.l = cell.l;
      td.dataset.r = cell.r;
      body(parseInline(cell.src), td, want);
      fill(td);
      tr.append(td);
    }
    clean.set(tr, src);
    return tr;
  }
  const div = document.createElement("div");
  if (hidden) {
    div.className = "ln meta";
    div.textContent = src;
  } else {
    decorate(div, line);
    body(parseInline(line.body), div, want);
  }
  fill(div);
  clean.set(div, src);
  return div;
}

/** Root-level nodes for `lines[from..to)`. Hidden lines (Aozora header notes) are painted as text. */
export function paint(
  lines: string[],
  from: number,
  to: number,
  hidden: (i: number) => boolean,
  want: (el: HTMLElement, key: string) => void,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  let table: HTMLTableSectionElement | null = null;
  for (let i = from; i < to; i++) {
    const keys: string[] = [];
    const el = paintLine(lines[i], hidden(i), (key) => keys.push(key));
    for (const key of keys) want(el, key);
    if (el.tagName === "TR") {
      if (!table) {
        const t = document.createElement("table");
        table = document.createElement("tbody");
        t.append(table);
        frag.append(t);
      }
      table.append(el);
    } else {
      table = null;
      frag.append(el);
    }
  }
  return frag;
}

export function lineEls(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of root.children) {
    if (el.tagName === "TABLE") out.push(...(el.querySelectorAll("tr") as NodeListOf<HTMLElement>));
    else out.push(el as HTMLElement);
  }
  return out;
}

export interface Pt {
  node: Node;
  offset: number;
}

interface Slot {
  node: Node;
  start: number;
  /** Text node: escaped text. Otherwise the element is atomic (ruby, note) or a cell. */
  text?: string;
  end: number;
}

function baseText(ruby: HTMLElement): string {
  let out = "";
  for (const kid of ruby.childNodes) if (!(kid instanceof HTMLElement && (kid.tagName === "RT" || kid.tagName === "RP"))) out += kid.textContent ?? "";
  return out;
}

const STRIP = /[\u200b\n\r]/g;

/** Serialize a line element, mapping DOM points to source offsets on the way. */
export function serialize(line: HTMLElement, pts: Pt[] = []): { text: string; at: number[]; slots: Slot[] } {
  const at = pts.map(() => -1);
  const slots: Slot[] = [];
  let out = line.dataset.pre ?? "";
  const hitEl = (node: Node, index: number) => {
    pts.forEach((p, k) => {
      if (at[k] < 0 && p.node === node && p.offset === index) at[k] = out.length;
    });
  };
  const kids = (node: Node) => {
    node.childNodes.forEach((kid, index) => {
      hitEl(node, index);
      walk(kid);
    });
    hitEl(node, node.childNodes.length);
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent ?? "";
      const t = raw.replace(STRIP, "");
      const esc = escapeText(t);
      pts.forEach((p, k) => {
        if (at[k] < 0 && p.node === node) at[k] = out.length + escapeText(raw.slice(0, p.offset).replace(STRIP, "")).length;
      });
      slots.push({ node, start: out.length, text: t, end: out.length + esc.length });
      out += esc;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName;
    if (tag === "BR" || tag === "RT" || tag === "RP") return;
    const start = out.length;
    if (node.className === "nt") {
      out += node.dataset.raw ?? "";
    } else if (tag === "RUBY" && node.dataset.auto !== undefined) {
      kids(node);
      return;
    } else if (tag === "RUBY") {
      const base = baseText(node);
      const reading = node.dataset.reading ?? "";
      if (node.dataset.raw && base === node.dataset.base) out += node.dataset.raw;
      else if (base) out += formatRubyMarkup(base, reading);
      else out += escapeText(reading);
    } else if (tag === "TD" || tag === "TH") {
      out += node.dataset.l ?? " ";
      kids(node);
      out += (node.dataset.r ?? " ") + "|";
      slots.push({ node, start, end: out.length });
      return;
    } else {
      const mark = node.dataset.az !== undefined ? "" : tag === "B" || tag === "STRONG" ? "**" : tag === "I" || tag === "EM" ? "*" : "";
      const empty = !(node.textContent ?? "").replace(STRIP, "");
      if (!empty) out += mark;
      kids(node);
      if (!empty) out += mark;
      return;
    }
    // Atomic element: any point inside snaps to its start, or its end if at the end of the base.
    pts.forEach((p, k) => {
      if (at[k] < 0 && node.contains(p.node)) {
        const atEnd = p.node.nodeType === Node.TEXT_NODE && !p.node.parentElement?.closest("rt") && p.offset >= (p.node.textContent?.length ?? 0);
        at[k] = atEnd ? out.length : start;
      }
    });
    slots.push({ node, start, end: out.length });
  };
  if (line.tagName === "TR") out += "|";
  const pre = out.length;
  kids(line);
  // A body that would read as markup at the start of a plain line gets escaped.
  if (!line.dataset.pre && line.tagName !== "TR" && /^(#{1,3} |[-*] |\t)/.test(out)) {
    out = "\\" + out;
    at.forEach((v, k) => (at[k] = v >= pre ? v + 1 : v));
    for (const s of slots) {
      s.start++;
      s.end++;
    }
  }
  pts.forEach((p, k) => {
    if (at[k] < 0) at[k] = line.contains(p.node) || p.node === line ? out.length : at[k];
  });
  return { text: out, at, slots };
}

export function lineSource(el: HTMLElement): string {
  const hit = clean.get(el);
  if (hit !== undefined) return hit;
  const text = serialize(el).text;
  clean.set(el, text);
  return text;
}

/** DOM point for a source offset inside a line. */
export function locate(line: HTMLElement, offset: number): Pt {
  const { slots } = serialize(line);
  for (const s of slots) {
    if (offset > s.end || (offset === s.end && s.text === undefined)) continue;
    if (s.text !== undefined) {
      let k = 0;
      let pos = s.start;
      while (k < s.text.length) {
        const ch = s.text[k];
        pos += /[\\｜|《》{}*]/.test(ch) || (ch === "＃" && s.text[k - 1] === "［") ? 2 : 1;
        if (pos > offset) break;
        k++;
      }
      return { node: s.node, offset: k };
    }
    const el = s.node as HTMLElement;
    if (el.tagName === "TD") {
      const text = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
      return text ? { node: text, offset: 0 } : { node: el, offset: 0 };
    }
    const parent = el.parentNode!;
    const index = [...parent.childNodes].indexOf(el as ChildNode);
    return { node: parent, offset: offset <= s.start ? index : index + 1 };
  }
  // Past everything: end of the line, before a trailing <br>.
  const last = line.tagName === "TR" ? (line.lastElementChild ?? line) : line;
  const n = last.childNodes.length;
  const br = last.lastChild instanceof HTMLElement && last.lastChild.tagName === "BR";
  return { node: last, offset: br ? n - 1 : n };
}
