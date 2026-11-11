import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { FuriMode } from "../lib/document";
import {
  domToPage,
  paintPage,
  selectRubyAt,
  selectSourceOffsets,
  serializePage,
  sourceSelection,
  type SourceSelection,
} from "../lib/pageEdit";

export interface PageHandle {
  focus(): void;
  selectAll(): void;
  selection(): SourceSelection | null;
  /** Move the caret in the document currently on screen. */
  selectSource(start: number, end: number): void;
  selectRuby(index: number): void;
  /** Apply after the next render, once `text` has been replaced. */
  queueSelection(start: number, end: number): void;
  element: HTMLElement | null;
}

export const Page = forwardRef<PageHandle, {
  text: string;
  furi: FuriMode;
  fontSize: number;
  onChange: (next: string) => void;
}>(function Page({ text, furi, fontSize, onChange }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const painted = useRef<string | null>(null);
  const composing = useRef(false);
  const pending = useRef<{ start: number; end: number } | null>(null);
  const textRef = useRef(text);
  textRef.current = text;

  const applyPending = (el: HTMLElement) => {
    const want = pending.current;
    if (!want) return;
    pending.current = null;
    selectSourceOffsets(el, textRef.current, want.start, want.end);
    el.focus();
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el || composing.current) return;
    if (painted.current === text) {
      applyPending(el);
      return;
    }
    paintPage(el, text);
    painted.current = text;
    applyPending(el);
  }, [text]);

  const emit = () => {
    const el = rootRef.current;
    if (!el || composing.current) return;
    const next = serializePage(domToPage(el, null)).text;
    painted.current = next;
    if (next !== textRef.current) onChange(next);
  };

  useImperativeHandle(ref, () => ({
    focus() {
      rootRef.current?.focus();
    },
    selectAll() {
      const el = rootRef.current;
      if (!el) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      el.focus();
    },
    selection() {
      const el = rootRef.current;
      if (!el) return null;
      return sourceSelection(el, textRef.current);
    },
    selectSource(start, end) {
      const el = rootRef.current;
      if (!el) return;
      pending.current = null;
      selectSourceOffsets(el, textRef.current, start, end);
      el.focus();
    },
    selectRuby(index) {
      const el = rootRef.current;
      if (!el) return;
      selectRubyAt(el, index);
    },
    queueSelection(start, end) {
      pending.current = { start, end };
    },
    get element() {
      return rootRef.current;
    },
  }));

  return (
    <div
      ref={rootRef}
      className={`paper page furi-${furi}`}
      data-testid="editor"
      data-markup={text}
      data-empty={text.length === 0 ? "yes" : "no"}
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
      onInput={() => emit()}
      onPaste={(event) => {
        event.preventDefault();
        const data = event.clipboardData.getData("text/plain");
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(data);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        emit();
      }}
    />
  );
});
