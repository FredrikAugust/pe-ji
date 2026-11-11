import { useEffect, useRef, useState } from "react";
import { MAX_QUERY, jishoUrl, lookup, type Entry } from "../lib/dict";
import { isTauri } from "../lib/files";
import { align } from "../lib/furigana";
import { Cap } from "./Pane";

/** Headword with the reading over its kanji only. */
function Head({ word, reading }: Entry) {
  if (!reading || word === reading) return <span className="w">{word}</span>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [s, e, r] of align(word, reading, 0)) {
    parts.push(word.slice(at, s), <ruby key={s}>{word.slice(s, e)}<rt>{r}</rt></ruby>);
    at = e;
  }
  parts.push(word.slice(at));
  return <span className="w">{parts}</span>;
}

function openJisho(e: React.MouseEvent, url: string) {
  if (!isTauri()) return;
  e.preventDefault();
  void import("@tauri-apps/api/core").then(({ invoke }) => invoke("open_jisho", { url }));
}

export function Dict({ seed, onClose }: { seed: { q: string; n: number } | null; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Entry[] | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef("");

  const search = async (word: string) => {
    const query = word.trim();
    if (!query) return;
    latest.current = query;
    setState("busy");
    try {
      const found = await lookup(query);
      if (latest.current !== query) return;
      setResults(found);
      setState("idle");
    } catch {
      if (latest.current === query) setState("error");
    }
  };

  useEffect(() => {
    if (!seed) return;
    setQ(seed.q);
    if (seed.q) void search(seed.q);
    else inputRef.current?.focus();
  }, [seed]);

  return (
    <aside className="dict" aria-label="辞書" data-testid="dict">
      <Cap title="ことばサーチ − Jisho.org" label="辞書を閉じる" onClose={onClose} />
      <form
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault();
          void search(q);
        }}
      >
        <input
          ref={inputRef}
          data-testid="dict-input"
          value={q}
          maxLength={MAX_QUERY}
          lang="ja"
          spellCheck={false}
          placeholder="漢字・かな・English"
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="tbtn">
          検索
        </button>
      </form>
      <div className="dict-body" data-testid="dict-results" aria-live="polite">
        {state === "busy" && <p className="dict-note">検索中…</p>}
        {state === "error" && <p className="dict-note">Jisho に接続できませんでした</p>}
        {state === "idle" && results?.length === 0 && <p className="dict-note">見つかりませんでした</p>}
        {state === "idle" &&
          results?.map((e, i) => (
            <div className="entry" key={i}>
              <div className="headword">
                <Head {...e} />
                <a
                  className="jisho-link"
                  href={jishoUrl(e.word)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(ev) => openJisho(ev, jishoUrl(e.word))}
                >
                  Jisho ↗
                </a>
              </div>
              <div className="tags">
                {e.common && <span className="tagp common">よく使う</span>}
                {e.jlpt && <span className="tagp jlpt">JLPT {e.jlpt}</span>}
              </div>
              <ol className="senses">
                {e.senses.map((s, k) => (
                  <li key={k}>
                    {s.pos && <div className="pos">{s.pos}</div>}
                    <div className="gloss">{s.gloss}</div>
                    {s.notes.length > 0 && <div className="note">{s.notes.join("・")}</div>}
                  </li>
                ))}
              </ol>
              {e.also.length > 0 && <div className="note">別の書き方：{e.also.join("、")}</div>}
            </div>
          ))}
      </div>
    </aside>
  );
}
