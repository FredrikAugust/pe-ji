/** Notes and corrections an AI leaves on exact quotes of the source text. */

export interface Note {
  id: string;
  kind: "correction" | "note";
  quote: string;
  comment: string;
  suggestion?: string | null;
  /** Source offset where the quote was when the note arrived; edits move it. */
  at: number;
}

/** Offset of the `n`th (1-based) match of `quote`, or -1. */
export function nth(text: string, quote: string, n: number): number {
  let i = -1;
  for (let k = 0; k < n; k++) {
    i = text.indexOf(quote, i + 1);
    if (i < 0) return -1;
  }
  return i;
}

/** Where the note's quote is now: the match closest to where it was, or -1 once it is gone. */
export function place(text: string, note: Note): number {
  let best = -1;
  for (let i = text.indexOf(note.quote); i >= 0; i = text.indexOf(note.quote, i + 1)) {
    if (best < 0 || Math.abs(i - note.at) < Math.abs(best - note.at)) best = i;
    if (i > note.at) break;
  }
  return best;
}
