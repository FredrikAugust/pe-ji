/**
 * DeepL translation through Rust (the key never reaches the web view).
 * Only Japanese → English or English → Japanese. One promise per text and direction for the session.
 */

import { isTauri } from "./files";

export type Translation = { text: string; from: string };
type Call = (text: string, target: string) => Promise<string>;

const memo = new Map<string, Promise<Translation>>();

export type Target = "EN-US" | "JA";

export const targetFor = (text: string): Target => (/[぀-ヿ㐀-鿿]/.test(text) ? "EN-US" : "JA");

/** Tests set `window.__picoTranslate`; the desktop app asks Rust. */
async function call(text: string, target: string): Promise<string> {
  const stub = (window as unknown as { __picoTranslate?: Call }).__picoTranslate;
  if (stub) return stub(text, target);
  if (!isTauri()) throw new Error("DESKTOP_ONLY");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("translate", { text, target });
}

export function translate(text: string, target: Target): Promise<Translation> {
  const key = `${target}\n${text.trim()}`;
  let hit = memo.get(key);
  if (!hit) {
    hit = call(text.trim(), target).then((raw) => {
      const t = (JSON.parse(raw) as { translations: { text: string; detected_source_language: string }[] }).translations[0];
      return { text: t.text, from: t.detected_source_language };
    });
    hit.catch(() => memo.delete(key));
    memo.set(key, hit);
  }
  return hit;
}

export async function saveKey(key: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_deepl_key", { key });
}
