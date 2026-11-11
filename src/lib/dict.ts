/**
 * Jisho lookups. The desktop app fetches and caches on disk in Rust (misses
 * too); this module keeps one promise per word for the session.
 */

import { isTauri } from "./files";

export interface Sense {
  pos: string;
  gloss: string;
  /** Jisho tags and notes, e.g. "Usually written using kana alone". */
  notes: string[];
}

export interface Entry {
  word: string;
  reading: string;
  common: boolean;
  jlpt: string;
  senses: Sense[];
  /** Other spellings and readings. */
  also: string[];
}

interface Raw {
  data: {
    is_common?: boolean;
    japanese: { word?: string; reading?: string }[];
    jlpt?: string[];
    senses: { english_definitions: string[]; parts_of_speech: string[]; tags?: string[]; info?: string[] }[];
  }[];
}

/** Rust rejects longer keys, so the cache file name stays short. */
export const MAX_QUERY = 30;

const memo = new Map<string, Promise<Entry[]>>();

export function lookup(query: string): Promise<Entry[]> {
  const key = [...query.trim()].slice(0, MAX_QUERY).join("");
  let hit = memo.get(key);
  if (!hit) {
    hit = fetchRaw(key).then((raw) => toEntries(JSON.parse(raw) as Raw));
    hit.catch(() => memo.delete(key));
    memo.set(key, hit);
  }
  return hit;
}

async function fetchRaw(keyword: string): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("jisho", { keyword });
  }
  const res = await fetch(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(keyword)}`);
  if (!res.ok) throw new Error(`Jisho ${res.status}`);
  return res.text();
}

export function toEntries(raw: Raw): Entry[] {
  return raw.data.slice(0, 10).map((d) => {
    const head = d.japanese[0] ?? {};
    return {
      word: head.word ?? head.reading ?? "",
      reading: head.reading ?? "",
      common: !!d.is_common,
      jlpt: (d.jlpt?.[0] ?? "").replace("jlpt-", "").toUpperCase(),
      senses: d.senses.slice(0, 5).map((s) => ({
        pos: s.parts_of_speech.join(", "),
        gloss: s.english_definitions.join("; "),
        notes: [...(s.tags ?? []), ...(s.info ?? [])],
      })),
      also: d.japanese.slice(1).map((f) => (f.word ? `${f.word}${f.reading ? `（${f.reading}）` : ""}` : f.reading ?? "")),
    };
  });
}

export const jishoUrl = (word: string) => `https://jisho.org/search/${encodeURIComponent(word)}`;
