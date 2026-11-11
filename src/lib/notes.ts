/** Notes and corrections an AI leaves on exact quotes of the source text. */

export interface Note {
  id: string;
  kind: "correction" | "note";
  /** The source text the note covers (may include ruby markup). */
  quote: string;
  /** The quote as the AI wrote it, for display. */
  label: string;
  comment: string;
  suggestion?: string | null;
  /** Source offset where the quote was when the note arrived; edits move it. */
  at: number;
}

/** Where the note's quote is now: the match closest to where it was, or -1 once it is gone. */
export function place(text: string, note: Pick<Note, "quote" | "at">): number {
  let best = -1;
  for (let i = text.indexOf(note.quote); i >= 0; i = text.indexOf(note.quote, i + 1)) {
    if (best < 0 || Math.abs(i - note.at) < Math.abs(best - note.at)) best = i;
    if (i > note.at) break;
  }
  return best;
}
