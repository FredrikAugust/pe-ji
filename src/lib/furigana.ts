/**
 * Automatic furigana. Rust (Lindera + IPADIC) splits each line into words and
 * returns katakana readings; this module puts the reading over the kanji only
 * (食べる → 食《た》べる) and caches by line text. Readings are never written to
 * the file.
 */

import { isTauri } from "./files";
import { isKanji } from "./parser";

/** [start, end, hiragana], UTF-16 offsets into the line's visible text. */
export type Reading = [number, number, string];
type Token = [number, number, string];

const cache = new Map<string, Reading[]>();

export function hasKanji(text: string): boolean {
  for (const ch of text) if (isKanji(ch.codePointAt(0)!)) return true;
  return false;
}

/** Cached readings for a line, `[]` when it needs none, `undefined` when not fetched yet. */
export function cachedReadings(text: string): Reading[] | undefined {
  return hasKanji(text) ? cache.get(text) : [];
}

const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** Readings over each kanji run of one token, okurigana left bare. */
export function align(surface: string, kata: string, at: number): Reading[] {
  const reading = toHira(kata);
  const runs: { text: string; kanji: boolean; at: number }[] = [];
  let i = 0;
  for (const ch of surface) {
    const kanji = isKanji(ch.codePointAt(0)!);
    const last = runs[runs.length - 1];
    if (last && last.kanji === kanji) last.text += ch;
    else runs.push({ text: ch, kanji, at: at + i });
    i += ch.length;
  }
  if (!runs.some((r) => r.kanji) || reading === toHira(surface)) return [];
  const pattern = runs.map((r) => (r.kanji ? "(.+?)" : toHira(r.text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("");
  const m = new RegExp(`^${pattern}$`).exec(reading);
  if (!m) return [[at, at + surface.length, reading]];
  let g = 1;
  return runs.filter((r) => r.kanji).map((r) => [r.at, r.at + r.text.length, m[g++]]);
}

type Source = (lines: string[]) => Promise<Token[][]>;

/** Tests set `window.__picoReadings`; the desktop app asks Rust; a plain browser has none. */
function source(): Source | null {
  const stub = (window as unknown as { __picoReadings?: Source }).__picoReadings;
  if (stub) return stub;
  if (!isTauri()) return null;
  return async (lines) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Token[][]>("readings", { lines });
  };
}

let queue: Promise<void> = Promise.resolve();

/** Fetch readings for lines not in the cache yet. Calls run one after another, so nothing is fetched twice. */
export function loadReadings(lines: string[]): Promise<void> {
  queue = queue.catch(() => {}).then(() => fetchMissing(lines));
  return queue;
}

async function fetchMissing(lines: string[]): Promise<void> {
  const get = source();
  const missing = [...new Set(lines)].filter((l) => cachedReadings(l) === undefined);
  if (!missing.length) return;
  if (!get) {
    // No tokenizer here (plain browser): remember that, so nothing keeps asking.
    for (const line of missing) cache.set(line, []);
    return;
  }
  // ponytail: one IPC per 500 lines; a whole novel is a few dozen calls, cached for the session.
  for (let k = 0; k < missing.length; k += 500) {
    const chunk = missing.slice(k, k + 500);
    const tokens = await get(chunk);
    chunk.forEach((line, n) => {
      cache.set(
        line,
        (tokens[n] ?? []).flatMap(([s, e, r]) => align(line.slice(s, e), r, s)),
      );
    });
  }
}
