import { useEffect, useRef, useState } from "react";
import { saveKey, targetFor, translate, type Target } from "../lib/translate";
import { Cap } from "./Pane";

const ERRORS: Record<string, string> = {
  NO_KEY: "DeepL の API キーを入れてください",
  BAD_KEY: "API キーが正しくありません",
  QUOTA: "今月の無料枠を使い切りました",
  DESKTOP_ONLY: "翻訳はデスクトップ版だけです",
};

const TO_KEY = "pico.translateTo";

export function Translate({ seed, onClose }: { seed: { q: string; n: number } | null; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [out, setOut] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [to, setTo] = useState<Target>(() => {
    try {
      return localStorage.getItem(TO_KEY) === "JA" ? "JA" : "EN-US";
    } catch {
      return "EN-US";
    }
  });
  const pick = (t: Target) => {
    setTo(t);
    try {
      localStorage.setItem(TO_KEY, t);
    } catch {}
  };

  const run = async (text: string, target = to) => {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      setOut((await translate(text, target)).text);
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
    if (!seed.q) {
      inputRef.current?.focus();
      return;
    }
    const t = targetFor(seed.q);
    pick(t);
    setQ(seed.q);
    void run(seed.q, t);
  }, [seed]);

  return (
    <aside className="dict" aria-label="翻訳" data-testid="translate">
      <Cap title="ほんやく − DeepL" label="翻訳を閉じる" onClose={onClose} />
      <form
        className="search-row tr-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(q);
        }}
      >
        <textarea ref={inputRef} data-testid="translate-input" value={q} lang="ja" rows={4} onChange={(e) => setQ(e.target.value)} />
        <div className="tr-buttons">
          <button
            type="button"
            className="tbtn"
            data-testid="translate-direction"
            title="方向を切り替える"
            onClick={() => {
              const t = to === "JA" ? "EN-US" : "JA";
              pick(t);
              void run(q, t);
            }}
          >
            {to === "JA" ? "英→日" : "日→英"}
          </button>
          <button type="submit" className="tbtn">
            翻訳
          </button>
        </div>
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
