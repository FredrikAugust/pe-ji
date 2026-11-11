/** Source-level edits. Every command maps (text, selection) to (text, selection). */

import { parseLine, splitCells, type Line } from "./parser";

export interface Edit {
  text: string;
  start: number;
  end: number;
}

/** Apply `fn` to the prefix of every line touched by [start, end]. `fn` returns the new prefix or null. */
export function mapLines(text: string, start: number, end: number, fn: (line: Line) => string | null): Edit | null {
  const lines = text.split("\n");
  let pos = 0;
  let out = "";
  let s = start;
  let e = end;
  let changed = false;
  lines.forEach((src, i) => {
    const lineEnd = pos + src.length;
    let oldPre = 0;
    let newPre = 0;
    if (lineEnd >= start && pos <= end) {
      const line = parseLine(src);
      const pre = fn(line);
      if (pre !== null && pre !== line.pre) {
        changed = true;
        oldPre = line.pre.length;
        newPre = pre.length;
        src = pre + src.slice(oldPre);
      }
    }
    const map = (at: number) => {
      const col = at - pos;
      return out.length + (col >= oldPre ? col + newPre - oldPre : newPre);
    };
    if (start >= pos && start <= lineEnd) s = map(start);
    if (end >= pos && end <= lineEnd) e = map(end);
    out += src + (i < lines.length - 1 ? "\n" : "");
    pos = lineEnd + 1;
  });
  return changed ? { text: out, start: s, end: e } : null;
}

const tabsOf = (line: Line) => /^\t*/.exec(line.pre)![0];

export type Block = "p" | "h1" | "h2" | "h3" | "li";

const MARK: Record<Block, string> = { p: "", h1: "# ", h2: "## ", h3: "### ", li: "- " };

/** Set the block style of every touched line; when all already have it, go back to body text. */
export function setBlock(text: string, start: number, end: number, kind: Block): Edit | null {
  let all = true;
  mapLines(text, start, end, (line) => {
    if (line.kind !== "row" && line.kind !== kind) all = false;
    return null;
  });
  const target = all && kind !== "p" ? "p" : kind;
  return mapLines(text, start, end, (line) => (line.kind === "row" ? null : tabsOf(line) + MARK[target]));
}

export function indent(text: string, start: number, end: number, dir: 1 | -1): Edit | null {
  return mapLines(text, start, end, (line) => {
    if (dir > 0) return "\t" + line.pre;
    return line.pre.startsWith("\t") ? line.pre.slice(1) : null;
  });
}

/** Backspace at the start of a body: drop the bullet/heading first, then one tab. */
export function outdentPrefix(line: Line): string {
  const tabs = tabsOf(line);
  return line.pre.length > tabs.length ? tabs : tabs.slice(1);
}

export function replace(text: string, start: number, end: number, insert: string): Edit {
  const at = start + insert.length;
  return { text: text.slice(0, start) + insert + text.slice(end), start: at, end: at };
}

export function lineAt(text: string, pos: number): { start: number; end: number } {
  const start = text.lastIndexOf("\n", pos - 1) + 1;
  const nl = text.indexOf("\n", pos);
  return { start, end: nl < 0 ? text.length : nl };
}

export const EMPTY_ROW = "|  |  |  |";

/** Insert a 3×2 table after the caret's line (or in place of an empty line). Caret lands in the first cell. */
export function insertTable(text: string, pos: number): Edit {
  const { start, end } = lineAt(text, pos);
  const table = `${EMPTY_ROW}\n${EMPTY_ROW}`;
  const empty = start === end;
  const before = empty ? text.slice(0, start) : text.slice(0, end) + "\n";
  const after = text.slice(end);
  const tail = after === "" ? "\n" : after;
  const at = before.length + 2;
  return { text: before + table + tail, start: at, end: at };
}

/** Add an empty row below the caret's row; the caret lands in its first cell. */
export function addRow(text: string, pos: number): Edit {
  const { end } = lineAt(text, pos);
  const line = parseLine(text.slice(lineAt(text, pos).start, end));
  const row = line.pre + "|" + "  |".repeat(Math.max(1, splitCells(line.body).length));
  const at = end + 1 + line.pre.length + 2;
  return { text: text.slice(0, end) + "\n" + row + text.slice(end), start: at, end: at };
}

/** Enter in a table row: add a row, or leave the table from an empty row. */
export function rowEnter(text: string, pos: number): Edit {
  const { start, end } = lineAt(text, pos);
  const line = parseLine(text.slice(start, end));
  if (splitCells(line.body).every((c) => !c.src)) return replace(text, start, end, line.pre);
  return addRow(text, pos);
}
