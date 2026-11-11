import { isPureKanji, parse } from "./parser";

export type InsertFail = "empty-selection" | "multiline" | "empty-reading";

export type InsertResult =
  | { ok: true; text: string; cursor: number; markup: string }
  | { ok: false; reason: InsertFail };

const BASE_SPECIAL = /[\\｜|《》{}]/g;
const READING_SPECIAL = /[\\》]/g;

export function formatRubyMarkup(base: string, reading: string): string {
  const escapedBase = base.replace(BASE_SPECIAL, (ch) => `\\${ch}`);
  const escapedReading = reading.replace(READING_SPECIAL, (ch) => `\\${ch}`);
  if (isPureKanji(base) && escapedBase === base) {
    return `${base}《${escapedReading}》`;
  }
  return `｜${escapedBase}《${escapedReading}》`;
}

export function insertRuby(text: string, a: number, b: number, reading: string): InsertResult {
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  if (start === end) return { ok: false, reason: "empty-selection" };
  const base = text.slice(start, end);
  if (base.includes("\n") || base.includes("\r")) return { ok: false, reason: "multiline" };
  const trimmed = reading.trim();
  if (!trimmed) return { ok: false, reason: "empty-reading" };
  const markup = formatRubyMarkup(base, trimmed);
  return {
    ok: true,
    text: text.slice(0, start) + markup + text.slice(end),
    cursor: start + markup.length,
    markup,
  };
}

export interface RubySpan {
  start: number;
  end: number;
}

export function rubySpans(text: string): RubySpan[] {
  return parse(text)
    .filter((seg) => seg.type === "ruby")
    .map((seg) => ({ start: seg.start, end: seg.end }));
}

/** Next ruby whose markup starts after `cursor`. Does not wrap. */
export function nextRuby(text: string, cursor: number): RubySpan | null {
  return rubySpans(text).find((span) => span.start > cursor) ?? null;
}

/** Previous ruby whose markup starts before `cursor`. Does not wrap. */
export function prevRuby(text: string, cursor: number): RubySpan | null {
  const spans = rubySpans(text);
  for (let i = spans.length - 1; i >= 0; i--) {
    if (spans[i].start < cursor) return spans[i];
  }
  return null;
}
