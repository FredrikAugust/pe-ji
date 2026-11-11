import { forwardRef, useEffect, useImperativeHandle, useRef, type ClipboardEvent } from "react";
import type { FuriMode } from "../lib/document";
import { addRow, indent, lineAt, mapLines, outdentPrefix, replace, rowEnter, type Edit } from "../lib/edit";
import { metaRange, parseLine, type Kind } from "../lib/parser";
import { loadReadings } from "../lib/furigana";
import { clean, decorate, lineEls, lineKeys, lineSource, locate, paint, paintLine, serialize, type Pt } from "./render";

export interface Selection {
  start: number;
  end: number;
  /** Visible text of the selection, readings excluded. */
  base: string;
}

export interface PageHandle {
  focus(): void;
  selectAll(): void;
  /** Source selection. Falls back to the last selection on the page when focus is elsewhere. */
  selection(): Selection | null;
  /** Select a source range and scroll to it. */
  select(start: number, end: number): void;
  /** DOM ranges for source ranges (for highlights). */
  ranges(spans: [number, number][]): Range[];
  edit(fn: (text: string, start: number, end: number) => Edit | null): boolean;
  format(cmd: "bold" | "italic"): void;
  tab(dir: 1 | -1): void;
  undo(dir: 1 | -1): void;
  element: HTMLElement | null;
}

/** File ruby and hidden notes are atomic; automatic readings are not. */
const ATOM = "ruby[data-base], .nt";

function elOf(node: Node): HTMLElement | null {
  return node instanceof HTMLElement ? node : node.parentElement;
}

/** Common prefix/suffix of two strings, for the caret after undo. */
function changedEnd(a: string, b: string): number {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return b.length - s;
}

export const Page = forwardRef<
  PageHandle,
  {
    /** A document to show. Only a new object repaints; the page's own edits come back through `onChange`. */
    doc: { text: string };
    empty: boolean;
    furi: FuriMode;
    fontSize: number;
    onChange: (next: string) => void;
    onKind: (kind: Kind) => void;
    onContextMenu: (e: React.MouseEvent) => void;
  }
>(function Page({ doc, empty, furi, fontSize, onChange, onKind, onContextMenu }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cur = useRef<{ lines: string[]; text: string }>({ lines: [], text: "" });
  const composing = useRef(false);
  const lastRange = useRef<Range | null>(null);
  const history = useRef<{ undo: string[]; redo: string[]; at: number }>({ undo: [], redo: [], at: -Infinity });
  const mo = useRef<MutationObserver | null>(null);
  const props = useRef({ onChange, onKind });
  props.current = { onChange, onKind };
  const enterShift = useRef(false);
  /** Lines whose readings are missing or stale; repainted once typing pauses. */
  const stale = useRef(new Set<HTMLElement>());
  const timer = useRef(0);

  // Short enough that readings keep up with typing, long enough to batch a burst of keys.
  const schedule = (ms = 30) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void refreshStale(), ms);
  };

  /** Repaint one line with readings, keeping the caret where it was. */
  const refresh = (el: HTMLElement) => {
    const src = lineSource(el);
    const keys: string[] = [];
    const fresh = paintLine(src, el.classList.contains("meta"), (k) => keys.push(k));
    if (keys.length) stale.current.add(fresh);
    if (fresh.innerHTML === el.innerHTML) {
      if (keys.length) stale.current.add(el);
      return;
    }
    const sel = window.getSelection();
    const pts: Pt[] = sel?.rangeCount && el.contains(sel.anchorNode) && el.contains(sel.focusNode)
      ? [{ node: sel.anchorNode!, offset: sel.anchorOffset }, { node: sel.focusNode!, offset: sel.focusOffset }]
      : [];
    const at = pts.length ? serialize(el, pts).at : [];
    el.replaceWith(fresh);
    mo.current?.takeRecords();
    if (at.length) {
      const a = locate(fresh, at[0]);
      const b = locate(fresh, at[1]);
      sel!.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
    }
  };

  const refreshStale = async () => {
    if (composing.current) return schedule();
    const els = [...stale.current].filter((el) => el.isConnected);
    stale.current.clear();
    if (!els.length) return;
    try {
      await loadReadings(els.flatMap((el) => lineKeys(lineSource(el))));
    } catch {
      return;
    }
    if (composing.current) {
      els.forEach((el) => stale.current.add(el));
      return schedule();
    }
    for (const el of els) if (el.isConnected) refresh(el);
    if (stale.current.size) schedule();
  };

  const markDirty = (records: MutationRecord[]) => {
    for (const r of records) {
      const line = elOf(r.target)?.closest(".ln");
      if (line) clean.delete(line);
    }
  };

  /** Repaint only the lines that differ from what is on screen. */
  const sync = (next: string) => {
    const root = rootRef.current!;
    const old = cur.current.lines;
    const lines = next.split("\n");
    let p = 0;
    let s = 0;
    const meta = metaRange(lines);
    if (JSON.stringify(meta) === JSON.stringify(metaRange(old))) {
      while (p < old.length && p < lines.length && old[p] === lines[p]) p++;
      while (s < old.length - p && s < lines.length - p && old[old.length - 1 - s] === lines[lines.length - 1 - s]) s++;
    }
    const blocks = [...root.children].map((el) => ({ el, n: el.tagName === "TABLE" ? el.querySelectorAll("tr").length : 1 }));
    let a = 0;
    let line = 0;
    while (a < blocks.length && line + blocks[a].n <= p) line += blocks[a++].n;
    // Rows next to the change may join or leave a table, so tables around it are repainted whole.
    if (a > 0 && blocks[a - 1].el.tagName === "TABLE") line -= blocks[--a].n;
    const start = line;
    let b = a;
    while (b < blocks.length && line < old.length - s) line += blocks[b++].n;
    if (b < blocks.length && blocks[b].el.tagName === "TABLE") line += blocks[b++].n;
    const ref = blocks[b]?.el ?? null;
    for (let k = a; k < b; k++) blocks[k].el.remove();
    const hidden = (i: number) => !!meta && i >= meta[0] && i <= meta[1];
    root.insertBefore(
      paint(lines, start, line + lines.length - old.length, hidden, (el) => stale.current.add(el)),
      ref,
    );
    if (stale.current.size) schedule(0);
    mo.current?.takeRecords();
    cur.current = { lines, text: next };
  };

  /** Wrap stray nodes the browser left at the top level into lines. */
  const normalize = (root: HTMLElement) => {
    let stray: HTMLElement | null = null;
    const sel = window.getSelection();
    const keep = sel?.rangeCount ? ([sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] as const) : null;
    let moved = false;
    for (const node of [...root.childNodes]) {
      if (node instanceof HTMLElement && (node.tagName === "TABLE" || node.classList.contains("ln"))) {
        stray = null;
        continue;
      }
      if (node instanceof HTMLElement && (node.tagName === "DIV" || node.tagName === "P")) {
        decorate(node, parseLine(""));
        stray = null;
        continue;
      }
      if (!stray) {
        stray = document.createElement("div");
        decorate(stray, parseLine(""));
        root.insertBefore(stray, node);
      }
      stray.append(node);
      moved = true;
    }
    if (moved && keep?.[0]?.isConnected && keep[2]?.isConnected) sel!.setBaseAndExtent(keep[0], keep[1], keep[2]!, keep[3]);
  };

  /** Text typed at the edge of a ruby lands inside its base; move it out. */
  const repairRubies = (lines: HTMLElement[]) => {
    const sel = window.getSelection();
    for (const line of lines) {
      if (clean.has(line)) continue;
      for (const ruby of line.querySelectorAll<HTMLElement>("ruby[data-base]")) {
        const t = ruby.firstChild;
        const want = ruby.dataset.base!;
        if (!(t instanceof Text) || t.data === want || ruby.childNodes.length !== 2) continue;
        const after = t.data.startsWith(want);
        if (!after && !t.data.endsWith(want)) continue;
        const extra = new Text(after ? t.data.slice(want.length) : t.data.slice(0, t.data.length - want.length));
        const caret = sel?.anchorNode === t ? sel.anchorOffset : -1;
        t.data = want;
        if (after) ruby.after(extra);
        else ruby.before(extra);
        if (caret >= 0) {
          const off = after ? caret - want.length : caret;
          if (off >= 0 && off <= extra.length) sel!.collapse(extra, off);
        }
      }
    }
  };

  const emit = () => {
    const root = rootRef.current;
    if (!root || composing.current) return;
    normalize(root);
    markDirty(mo.current?.takeRecords() ?? []);
    let els = lineEls(root);
    repairRubies(els);
    markDirty(mo.current?.takeRecords() ?? []);
    els = lineEls(root);
    for (const el of els) if (!clean.has(el)) stale.current.add(el);
    if (stale.current.size) schedule();
    const lines = els.map(lineSource);
    const next = lines.join("\n");
    const prev = cur.current.text;
    cur.current = { lines, text: next };
    if (next === prev) return;
    const h = history.current;
    const now = performance.now();
    if (now - h.at > 1000) {
      h.undo.push(prev);
      if (h.undo.length > 200) h.undo.shift();
      h.redo = [];
      h.at = now;
    }
    props.current.onChange(next);
  };

  /** Map a DOM point to its line element and a point inside it. */
  const linePoint = (p: Pt): { line: HTMLElement; pt: Pt } | null => {
    const root = rootRef.current!;
    const line = elOf(p.node)?.closest<HTMLElement>(".ln");
    if (line && root.contains(line)) return { line, pt: p };
    if (!(p.node instanceof HTMLElement) || !root.contains(p.node)) return null;
    const kid = p.node.childNodes[p.offset];
    const first = kid instanceof HTMLElement ? (kid.matches(".ln") ? kid : kid.querySelector<HTMLElement>(".ln")) : null;
    if (first) return { line: first, pt: { node: first, offset: 0 } };
    const all = p.node === root ? lineEls(root) : [...p.node.querySelectorAll<HTMLElement>(".ln")];
    const last = all[all.length - 1];
    return last ? { line: last, pt: { node: last, offset: last.childNodes.length } } : null;
  };

  const lineStart = (i: number) => {
    let pos = 0;
    for (let k = 0; k < i; k++) pos += cur.current.lines[k].length + 1;
    return pos;
  };

  /** Source offsets of a DOM range. A non-collapsed range grows to whole rubies. */
  const toSource = (range: Range): { start: number; end: number } | null => {
    emit();
    const root = rootRef.current!;
    const ends: Pt[] = [
      { node: range.startContainer, offset: range.startOffset },
      { node: range.endContainer, offset: range.endOffset },
    ];
    if (!range.collapsed) {
      ends.forEach((p, k) => {
        const atom = elOf(p.node)?.closest(ATOM);
        if (atom && root.contains(atom)) {
          const index = [...atom.parentNode!.childNodes].indexOf(atom);
          ends[k] = { node: atom.parentNode!, offset: index + k };
        }
      });
    }
    const els = lineEls(root);
    let adopted = false;
    const abs = ends.map((p) => {
      const lp = linePoint(p);
      if (!lp) return 0;
      const i = els.indexOf(lp.line);
      const r = serialize(lp.line, [lp.pt]);
      if (r.text !== cur.current.lines[i]) {
        // The canonical form differs from the painted source; adopt it so offsets line up.
        clean.set(lp.line, r.text);
        cur.current.lines[i] = r.text;
        adopted = true;
      }
      return lineStart(i) + r.at[0];
    });
    if (adopted) {
      cur.current.text = cur.current.lines.join("\n");
      props.current.onChange(cur.current.text);
    }
    return { start: Math.min(abs[0], abs[1]), end: Math.max(abs[0], abs[1]) };
  };

  const currentRange = (): Range | null => {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (root && sel?.rangeCount && root.contains(sel.anchorNode)) return sel.getRangeAt(0);
    return lastRange.current;
  };

  /** DOM point for a source offset. */
  const pointAt = (abs: number, els = lineEls(rootRef.current!)): Pt => {
    const lines = cur.current.lines;
    let i = 0;
    let pos = 0;
    while (i < lines.length - 1 && pos + lines[i].length < abs) pos += lines[i++].length + 1;
    return locate(els[i], abs - pos);
  };

  const setCaret = (start: number, end: number) => {
    const root = rootRef.current!;
    const els = lineEls(root);
    const a = pointAt(start, els);
    const b = start === end ? a : pointAt(end, els);
    root.focus();
    window.getSelection()?.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
    elOf(b.node)?.scrollIntoView({ block: "nearest" });
  };

  /** Focus alone leaves the caret on the page box itself, drawn in its corner; put it at the start of the text. */
  const caretIntoText = () => {
    const root = rootRef.current;
    const at = window.getSelection()?.anchorNode;
    if (root?.querySelector(".ln") && !(at && root.contains(at) && elOf(at)?.closest(".ln"))) setCaret(0, 0);
  };

  const apply = (e: Edit) => {
    const h = history.current;
    h.undo.push(cur.current.text);
    h.redo = [];
    h.at = -Infinity;
    sync(e.text);
    setCaret(e.start, e.end);
    props.current.onChange(e.text);
  };

  const edit = (fn: (text: string, start: number, end: number) => Edit | null): boolean => {
    const range = currentRange();
    const s = range ? toSource(range) : { start: 0, end: 0 };
    if (!s) return false;
    const r = fn(cur.current.text, s.start, s.end);
    if (!r) return false;
    apply(r);
    return true;
  };

  const undo = (dir: 1 | -1) => {
    emit();
    const h = history.current;
    const from = dir < 0 ? h.undo : h.redo;
    const to = dir < 0 ? h.redo : h.undo;
    const prev = from.pop();
    if (prev === undefined) return;
    to.push(cur.current.text);
    h.at = -Infinity;
    const at = changedEnd(cur.current.text, prev);
    sync(prev);
    setCaret(at, at);
    props.current.onChange(prev);
  };

  /** Make the next change its own undo step. */
  const checkpoint = () => {
    history.current.at = -Infinity;
  };

  const enter = (shift: boolean) => {
    emit();
    checkpoint();
    const root = rootRef.current!;
    const sel = window.getSelection()!;
    if (!sel.isCollapsed) {
      document.execCommand("delete");
      emit();
    }
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const lp = linePoint({ node: range.startContainer, offset: range.startOffset });
    if (!lp) return;
    const { line } = lp;
    if (line.tagName === "TR") {
      edit((t, s) => rowEnter(t, s));
      return;
    }
    const pre = line.dataset.pre ?? "";
    const kind = parseLine(pre + "x").kind;
    const r = serialize(line, [lp.pt]);
    const body = r.text.slice(pre.length);
    if (kind === "li" && !body) {
      edit((t, s, e) => mapLines(t, s, e, (l) => /^\t*/.exec(l.pre)![0]));
      return;
    }
    if (kind !== "p" && kind !== "li" && r.at[0] <= pre.length && body) {
      edit((t, s) => {
        const { start } = lineAt(t, s);
        return replace(t, start, start, "\n");
      });
      return;
    }
    // Split in the DOM so emphasis that spans the caret is closed and reopened by the serializer.
    let pt = lp.pt;
    const atom = elOf(pt.node)?.closest(ATOM);
    if (atom && line.contains(atom)) {
      const index = [...atom.parentNode!.childNodes].indexOf(atom);
      const atEnd = r.at[0] > serialize(line, [{ node: atom.parentNode!, offset: index }]).at[0];
      pt = { node: atom.parentNode!, offset: index + (atEnd ? 1 : 0) };
    }
    const tail = document.createRange();
    tail.setStart(pt.node, pt.offset);
    tail.setEnd(line, line.childNodes.length);
    const frag = tail.extractContents();
    const next = document.createElement("div");
    const tabs = /^\t*/.exec(pre)![0];
    decorate(next, parseLine((shift ? "" : kind === "li" ? pre : tabs) + "x"));
    next.append(frag);
    for (const el of [line, next]) {
      el.querySelectorAll(":scope > br").forEach((br) => br !== el.lastChild && br.remove());
      if (!(el.textContent ?? "") && !el.querySelector("br")) el.append(document.createElement("br"));
    }
    line.after(next);
    const first = next.firstChild instanceof Text ? next.firstChild : next;
    sel.collapse(first, 0);
    emit();
    checkpoint();
    root.focus();
  };

  const backspaceAtStart = (): boolean => {
    const sel = window.getSelection();
    if (!sel?.isCollapsed || !sel.rangeCount) return false;
    const lp = linePoint({ node: sel.anchorNode!, offset: sel.anchorOffset });
    if (!lp || lp.line.tagName === "TR" || !lp.line.dataset.pre) return false;
    if (serialize(lp.line, [lp.pt]).at[0] !== lp.line.dataset.pre.length) return false;
    return edit((t, s, e) => mapLines(t, s, e, outdentPrefix));
  };

  const tab = (dir: 1 | -1) => {
    const range = currentRange();
    const td = range && elOf(range.startContainer)?.closest("td");
    if (td && rootRef.current!.contains(td)) {
      const cells = [...td.closest("table")!.querySelectorAll("td")];
      const next = cells[cells.indexOf(td) + dir];
      if (next) {
        const sel = window.getSelection()!;
        const last = next.lastChild;
        if (last instanceof Text) sel.collapse(last, last.length);
        else sel.collapse(next, last instanceof HTMLElement && last.tagName === "BR" ? 0 : next.childNodes.length);
        rootRef.current!.focus();
      } else if (dir > 0) edit((t, s) => addRow(t, s));
      return;
    }
    edit((t, s, e) => indent(t, s, e, dir));
  };

  useEffect(() => {
    const root = rootRef.current!;
    mo.current = new MutationObserver(markDirty);
    mo.current.observe(root, { childList: true, subtree: true, characterData: true });
    document.execCommand("styleWithCSS", false, "false");
    Object.defineProperty(root, "markup", { get: () => cur.current.text, configurable: true });

    const onBeforeInput = (e: InputEvent) => {
      if (e.isComposing || composing.current) return;
      switch (e.inputType) {
        case "historyUndo":
        case "historyRedo":
          e.preventDefault();
          undo(e.inputType === "historyUndo" ? -1 : 1);
          return;
        case "insertParagraph":
        case "insertLineBreak":
          // Some IMEs (macOS kana mode) send a line break for plain Enter, so only Shift counts.
          e.preventDefault();
          enter(enterShift.current);
          enterShift.current = false;
          return;
        case "insertFromDrop":
          e.preventDefault();
          return;
        case "deleteContentBackward":
          if (backspaceAtStart()) e.preventDefault();
          return;
        case "insertText":
          if (e.data?.includes("\n")) {
            e.preventDefault();
            edit((t, s, en) => replace(t, s, en, e.data!.replace(/\r\n?/g, "\n")));
          }
      }
    };
    const onSelection = () => {
      const sel = window.getSelection();
      if (!sel?.rangeCount || !root.contains(sel.anchorNode)) return;
      // Furigana is only a picture: a caret that lands in a reading moves after its word.
      const rt = sel.isCollapsed ? elOf(sel.anchorNode!)?.closest("rt") : null;
      if (rt?.parentElement) {
        sel.collapse(rt.parentElement.parentNode!, [...rt.parentElement.parentNode!.childNodes].indexOf(rt.parentElement) + 1);
        return;
      }
      lastRange.current = sel.getRangeAt(0).cloneRange();
      const line = elOf(sel.anchorNode!)?.closest(".ln");
      const kind = (["h1", "h2", "h3", "li", "row"] as const).find((k) => line?.classList.contains(k)) ?? "p";
      props.current.onKind(kind);
    };
    root.addEventListener("beforeinput", onBeforeInput);
    document.addEventListener("selectionchange", onSelection);
    return () => {
      mo.current?.disconnect();
      root.removeEventListener("beforeinput", onBeforeInput);
      document.removeEventListener("selectionchange", onSelection);
    };
    // The handlers read everything through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    composing.current = false;
    history.current = { undo: [], redo: [], at: -Infinity };
    // Paint with readings when they come back quickly; otherwise paint now and add them after.
    const keys = doc.text.split("\n").flatMap(lineKeys);
    const ready = loadReadings(keys).catch(() => {});
    void Promise.race([ready, new Promise((r) => setTimeout(r, 300))]).then(() => {
      if (!live) return;
      sync(doc.text);
      if (document.activeElement === rootRef.current) caretIntoText();
    });
    return () => {
      live = false;
    };
  }, [doc]);

  useImperativeHandle(ref, () => ({
    focus() {
      const root = rootRef.current;
      if (!root) return;
      root.focus();
      caretIntoText();
    },
    selectAll() {
      const el = rootRef.current;
      if (!el) return;
      el.focus();
      window.getSelection()?.selectAllChildren(el);
    },
    selection() {
      const range = currentRange();
      if (!range) return null;
      const s = toSource(range);
      if (!s) return null;
      const frag = range.cloneContents();
      frag.querySelectorAll("rt, rp, .nt").forEach((n) => n.remove());
      return { ...s, base: (frag.textContent ?? "").replace(/\u200b/g, "") };
    },
    edit,
    select: setCaret,
    ranges(spans) {
      const els = lineEls(rootRef.current!);
      return spans.map(([s, e]) => {
        const a = pointAt(s, els);
        const b = pointAt(e, els);
        const r = document.createRange();
        r.setStart(a.node, a.offset);
        r.setEnd(b.node, b.offset);
        return r;
      });
    },
    format(cmd) {
      const range = currentRange();
      const root = rootRef.current!;
      root.focus();
      if (range) window.getSelection()?.setBaseAndExtent(range.startContainer, range.startOffset, range.endContainer, range.endOffset);
      emit();
      checkpoint();
      document.execCommand(cmd);
      checkpoint();
    },
    tab,
    undo,
    get element() {
      return rootRef.current;
    },
  }));

  const copy = (e: ClipboardEvent, cut: boolean) => {
    const range = currentRange();
    const s = range && toSource(range);
    e.preventDefault();
    if (!s || s.start === s.end) return;
    e.clipboardData.setData("text/plain", cur.current.text.slice(s.start, s.end));
    if (cut) apply(replace(cur.current.text, s.start, s.end, ""));
  };

  return (
    <div
      ref={rootRef}
      className={`page furi-${furi}`}
      data-testid="editor"
      data-empty={empty ? "yes" : "no"}
      data-furigana-mode={furi}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="作文"
      lang="ja"
      spellCheck={false}
      style={{ fontSize }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        emit();
      }}
      onInput={emit}
      onKeyDown={(e) => {
        if (e.key === "Enter") enterShift.current = e.shiftKey;
        // ⌘A and Ctrl+A both select the whole page (Ctrl+A would otherwise jump to line start on macOS).
        if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a") {
          e.preventDefault();
          window.getSelection()?.selectAllChildren(e.currentTarget);
        }
        // WebKit stops twice at the end of a word with furigana (end of the kanji, then after the word),
        // so Shift+←/→ sometimes seems to do nothing. Step again when the selection did not change.
        if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !e.nativeEvent.isComposing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          const sel = window.getSelection();
          if (!sel?.rangeCount) return;
          e.preventDefault();
          const dir = e.key === "ArrowLeft" ? "backward" : "forward";
          const before = sel.toString();
          sel.modify("extend", dir, "character");
          if (sel.toString() === before) sel.modify("extend", dir, "character");
        }
      }}
      onContextMenu={onContextMenu}
      onCopy={(e) => copy(e, false)}
      onCut={(e) => copy(e, true)}
      onPaste={(e) => {
        e.preventDefault();
        const data = e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
        edit((t, s, en) => replace(t, s, en, data));
      }}
    />
  );
});
