import { useEffect, useState } from "react";
import { saveKey, translate } from "../lib/translate";

const ERRORS: Record<string, string> = {
  NO_KEY: "DeepL の API キーを入れてください",
  BAD_KEY: "API キーが正しくありません",
  QUOTA: "今月の無料枠を使い切りました",
  DESKTOP_ONLY: "翻訳はデスクトップ版だけです",
};

export function Translate({ seed }: { seed: { q: string; n: number } | null }) {
  const [q, setQ] = useState("");
  const [out, setOut] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  const run = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      setOut((await translate(text)).text);
    } catch (e) {
      const code = String(e).replace(/^Error: /, "");
      setOut("");
      setError(code);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!seed) return;
    setQ(seed.q);
    void run(seed.q);
  }, [seed]);

  return (
    <aside className="dict" aria-label="翻訳" data-testid="translate">
      <div className="dict-cap">ほんやく − DeepL</div>
      <form
        className="search-row tr-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(q);
        }}
      >
        <textarea data-testid="translate-input" value={q} lang="ja" rows={4} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="tbtn">
          翻訳
        </button>
      </form>
      <div className="dict-body" data-testid="translate-result" aria-live="polite">
        {busy && <p className="dict-note">翻訳中…</p>}
        {!busy && error && <p className="dict-note">{ERRORS[error] ?? error}</p>}
        {!busy && !error && out && <p className="dict-note tr-out">{out}</p>}
        {(error === "NO_KEY" || error === "BAD_KEY") && (
          <form
            className="search-row"
            onSubmit={(e) => {
              e.preventDefault();
              void saveKey(key).then(() => run(q));
            }}
          >
            <input data-testid="deepl-key" type="password" placeholder="xxxx-…:fx" value={key} onChange={(e) => setKey(e.target.value)} />
            <button type="submit" className="tbtn">
              保存
            </button>
          </form>
        )}
      </div>
    </aside>
  );
}
