import { place, type Note } from "../lib/notes";
import { Cap } from "./Pane";

export function Notes(props: {
  notes: Note[];
  text: string;
  onPick: (note: Note) => void;
  onApply: (note: Note) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="dict" aria-label="メモ・訂正" data-testid="notes">
      <Cap title="メモ・訂正（AI）" label="メモを閉じる" onClose={props.onClose} />
      <div className="dict-body">
        {props.notes.length === 0 && <p className="dict-note">まだありません。AI と接続すると、ここに届きます。</p>}
        {props.notes.map((n) => {
          const gone = place(props.text, n) < 0;
          return (
            <div className={`entry note-${n.kind}`} key={n.id} data-testid="note">
              <button type="button" className="note-quote" disabled={gone} onClick={() => props.onPick(n)}>
                <span className={`tagp ${n.kind === "correction" ? "jlpt" : ""}`}>{n.kind === "correction" ? "訂正" : "メモ"}</span>
                <span className="q">{n.label}</span>
                {n.suggestion && <span className="q"> → {n.suggestion}</span>}
              </button>
              <div className="gloss">{n.comment}</div>
              {gone && <div className="note">（本文にもうありません）</div>}
              <div className="dialog-actions">
                {n.kind === "correction" && n.suggestion != null && !gone && (
                  <button type="button" className="tbtn lime" onClick={() => props.onApply(n)}>
                    適用
                  </button>
                )}
                <button type="button" className="tbtn" onClick={() => props.onRemove(n.id)}>
                  消す
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
