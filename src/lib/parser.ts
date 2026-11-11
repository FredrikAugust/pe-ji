/**
 * Furigana markup parser. Keep this in lockstep with `crates/pico-core`
 * and `testdata/ruby_cases.json`.
 *
 * - `漢字《かんじ》` implicit base (kanji run immediately before 《)
 * - `｜base《reading》` or `|base《reading》` explicit base
 * - `{base|reading}` brace form (half-width pipe)
 * - `\X` escapes the next character
 * - ruby never crosses a newline; unmatched brackets stay literal
 */

export type Segment =
  | { type: "text"; text: string; start: number; end: number }
  | { type: "ruby"; base: string; reading: string; start: number; end: number };

const BSLASH = 0x5c;
const LB = 0x7b;
const RB = 0x7d;
const PIPE = 0x7c;
const FPIPE = 0xff5c;
const OPEN = 0x300a;
const CLOSE = 0x300b;

export function isNl(cp: number): boolean {
  return cp === 0x0a || cp === 0x0d;
}

export function isKanji(cp: number): boolean {
  return (
    cp === 0x3005 ||
    cp === 0x3006 ||
    cp === 0x303b ||
    cp === 0x30f5 ||
    cp === 0x30f6 ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) ||
    (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0x2ceb0 && cp <= 0x2ebef) ||
    (cp >= 0x30000 && cp <= 0x3134f) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}

export function readCp(s: string, i: number): { cp: number; next: number } | null {
  if (i >= s.length) return null;
  const c = s.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
    const c2 = s.charCodeAt(i + 1);
    if (c2 >= 0xdc00 && c2 <= 0xdfff) {
      return { cp: (c - 0xd800) * 0x400 + (c2 - 0xdc00) + 0x10000, next: i + 2 };
    }
  }
  return { cp: c, next: i + 1 };
}

export function isPureKanji(s: string): boolean {
  if (!s) return false;
  let i = 0;
  while (i < s.length) {
    const c = readCp(s, i);
    if (!c || !isKanji(c.cp)) return false;
    i = c.next;
  }
  return true;
}

function pushText(out: Segment[], text: string, start: number, end: number) {
  if (end <= start && !text) return;
  const last = out[out.length - 1];
  if (last && last.type === "text" && last.end === start) {
    last.text += text;
    last.end = end;
    return;
  }
  out.push({ type: "text", text, start, end });
}

function tryReading(s: string, i: number): { reading: string; next: number } | null {
  const open = readCp(s, i);
  if (!open || open.cp !== OPEN) return null;
  let j = open.next;
  let reading = "";
  while (j < s.length) {
    const c = readCp(s, j)!;
    if (isNl(c.cp)) return null;
    if (c.cp === BSLASH) {
      const n = readCp(s, c.next);
      if (!n || isNl(n.cp)) return null;
      reading += String.fromCodePoint(n.cp);
      j = n.next;
      continue;
    }
    if (c.cp === CLOSE) return { reading, next: c.next };
    reading += String.fromCodePoint(c.cp);
    j = c.next;
  }
  return null;
}

function tryExplicit(s: string, i: number): { base: string; reading: string; next: number } | null {
  const pipe = readCp(s, i)!;
  let j = pipe.next;
  let base = "";
  while (j < s.length) {
    const c = readCp(s, j)!;
    if (isNl(c.cp)) return null;
    if (c.cp === BSLASH) {
      const n = readCp(s, c.next);
      if (!n || isNl(n.cp)) return null;
      base += String.fromCodePoint(n.cp);
      j = n.next;
      continue;
    }
    if (c.cp === OPEN) {
      if (!base) return null;
      const reading = tryReading(s, j);
      if (!reading) return null;
      return { base, reading: reading.reading, next: reading.next };
    }
    base += String.fromCodePoint(c.cp);
    j = c.next;
  }
  return null;
}

function tryBrace(s: string, i: number): { base: string; reading: string; next: number } | null {
  const open = readCp(s, i)!;
  let j = open.next;
  let base = "";
  let reading = "";
  let sawPipe = false;
  while (j < s.length) {
    const c = readCp(s, j)!;
    if (isNl(c.cp)) return null;
    if (c.cp === BSLASH) {
      const n = readCp(s, c.next);
      if (!n || isNl(n.cp)) return null;
      if (sawPipe) reading += String.fromCodePoint(n.cp);
      else base += String.fromCodePoint(n.cp);
      j = n.next;
      continue;
    }
    if (c.cp === PIPE && !sawPipe) {
      sawPipe = true;
      j = c.next;
      continue;
    }
    if (c.cp === RB) {
      if (!sawPipe || !base) return null;
      return { base, reading, next: c.next };
    }
    if (sawPipe) reading += String.fromCodePoint(c.cp);
    else base += String.fromCodePoint(c.cp);
    j = c.next;
  }
  return null;
}

export function parse(input: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  while (i < input.length) {
    const c = readCp(input, i)!;
    if (c.cp === BSLASH) {
      const n = readCp(input, c.next);
      if (n && !isNl(n.cp)) {
        pushText(out, String.fromCodePoint(n.cp), i, n.next);
        i = n.next;
        continue;
      }
      pushText(out, "\\", i, c.next);
      i = c.next;
      continue;
    }
    if (c.cp === LB) {
      const brace = tryBrace(input, i);
      if (brace) {
        out.push({
          type: "ruby",
          base: brace.base,
          reading: brace.reading,
          start: i,
          end: brace.next,
        });
        i = brace.next;
        continue;
      }
    }
    if (c.cp === PIPE || c.cp === FPIPE) {
      const explicit = tryExplicit(input, i);
      if (explicit) {
        out.push({
          type: "ruby",
          base: explicit.base,
          reading: explicit.reading,
          start: i,
          end: explicit.next,
        });
        i = explicit.next;
        continue;
      }
    }
    if (isKanji(c.cp)) {
      const start = i;
      let j = i;
      while (j < input.length) {
        const k = readCp(input, j)!;
        if (!isKanji(k.cp)) break;
        j = k.next;
      }
      const reading = tryReading(input, j);
      if (reading) {
        out.push({
          type: "ruby",
          base: input.slice(start, j),
          reading: reading.reading,
          start,
          end: reading.next,
        });
        i = reading.next;
        continue;
      }
      pushText(out, input.slice(start, j), start, j);
      i = j;
      continue;
    }
    pushText(out, String.fromCodePoint(c.cp), i, c.next);
    i = c.next;
  }
  return out;
}

export function renderHtml(input: string): string {
  let out = "";
  for (const seg of parse(input)) {
    if (seg.type === "text") out += textToHtml(seg.text);
    else out += `<ruby>${escapeHtml(seg.base)}<rt>${escapeHtml(seg.reading)}</rt></ruby>`;
  }
  return out;
}

function textToHtml(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = readCp(text, i)!;
    if (c.cp === 0x0d) {
      out += "<br>";
      const n = readCp(text, c.next);
      i = n && n.cp === 0x0a ? n.next : c.next;
      continue;
    }
    if (c.cp === 0x0a) {
      out += "<br>";
      i = c.next;
      continue;
    }
    out += escapeHtml(String.fromCodePoint(c.cp));
    i = c.next;
  }
  return out;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface Inline {
  type: "text" | "ruby";
  text?: string;
  base?: string;
  reading?: string;
}

/** Split parsed segments into visual lines. `\r\n` and `\r` count as one break. */
export function toLines(segments: Segment[]): Inline[][] {
  const lines: Inline[][] = [[]];
  for (const seg of segments) {
    if (seg.type === "ruby") {
      lines[lines.length - 1].push({ type: "ruby", base: seg.base, reading: seg.reading });
      continue;
    }
    const normalized = seg.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const parts = normalized.split("\n");
    parts.forEach((part, idx) => {
      if (part) lines[lines.length - 1].push({ type: "text", text: part });
      if (idx < parts.length - 1) lines.push([]);
    });
  }
  return lines;
}
