/**
 * The file is plain text, one source line per paragraph.
 *
 * Line prefix: leading tabs indent; then `# `/`## `/`### ` heading, `- `/`* `
 * bullet, or an Aozora `［＃N字下げ］`. A line `| a | b |` is a table row.
 *
 * Inline: ruby (`漢字《かんじ》`, `｜食べ《た》`, `{漢字|かんじ}`), `**bold**`,
 * `*italic*`, Aozora notes `［＃…］`, and `\X` escapes. Ruby never crosses a
 * newline; unmatched markup stays literal. Notes we do not understand are kept
 * verbatim and hidden.
 */

export type Inline =
  | { t: "text"; s: string; from: number; to: number }
  | { t: "ruby"; base: string; reading: string; raw: string }
  | { t: "note"; raw: string }
  | { t: "b" | "i"; kids: Inline[] }
  | { t: "az"; cls: string; kids: Inline[] };

export type Kind = "p" | "h1" | "h2" | "h3" | "li" | "row";

export interface Line {
  pre: string;
  kind: Kind;
  /** In em. */
  indent: number;
  body: string;
}

export interface Cell {
  l: string;
  r: string;
  src: string;
  /** Offset of `src` in the line. */
  at: number;
}

const BSLASH = 0x5c;
const LB = 0x7b;
const RB = 0x7d;
const PIPE = 0x7c;
const FPIPE = 0xff5c;
const OPEN = 0x300a;
const CLOSE = 0x300b;
const STAR = 0x2a;

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
    (cp >= 0x20000 && cp <= 0x2ebef) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f) ||
    (cp >= 0x30000 && cp <= 0x3134f)
  );
}

export function readCp(s: string, i: number): { cp: number; next: number } | null {
  if (i >= s.length) return null;
  const cp = s.codePointAt(i)!;
  return { cp, next: i + (cp > 0xffff ? 2 : 1) };
}

export function isPureKanji(s: string): boolean {
  if (!s) return false;
  for (const ch of s) if (!isKanji(ch.codePointAt(0)!)) return false;
  return true;
}

/** Reads `《…》` at `i`. Lines never contain a newline, so only the bracket can end it. */
function tryReading(s: string, i: number): { reading: string; next: number } | null {
  if (s.charCodeAt(i) !== OPEN) return null;
  let j = i + 1;
  let reading = "";
  while (j < s.length) {
    const c = s.charCodeAt(j);
    if (c === BSLASH && j + 1 < s.length) {
      const n = readCp(s, j + 1)!;
      reading += String.fromCodePoint(n.cp);
      j = n.next;
      continue;
    }
    if (c === CLOSE) return { reading, next: j + 1 };
    reading += s[j];
    j++;
  }
  return null;
}

function tryExplicit(s: string, i: number): { base: string; reading: string; next: number } | null {
  let j = i + 1;
  let base = "";
  while (j < s.length) {
    const c = s.charCodeAt(j);
    if (c === BSLASH && j + 1 < s.length) {
      const n = readCp(s, j + 1)!;
      base += String.fromCodePoint(n.cp);
      j = n.next;
      continue;
    }
    if (c === OPEN) {
      if (!base) return null;
      const r = tryReading(s, j);
      return r && { base, reading: r.reading, next: r.next };
    }
    base += s[j];
    j++;
  }
  return null;
}

function tryBrace(s: string, i: number): { base: string; reading: string; next: number } | null {
  let j = i + 1;
  let base = "";
  let reading = "";
  let sawPipe = false;
  while (j < s.length) {
    const c = s.charCodeAt(j);
    if (c === BSLASH && j + 1 < s.length) {
      const n = readCp(s, j + 1)!;
      if (sawPipe) reading += String.fromCodePoint(n.cp);
      else base += String.fromCodePoint(n.cp);
      j = n.next;
      continue;
    }
    if (c === PIPE && !sawPipe) {
      sawPipe = true;
      j++;
      continue;
    }
    if (c === RB) return sawPipe && base ? { base, reading, next: j + 1 } : null;
    if (sawPipe) reading += s[j];
    else base += s[j];
    j++;
  }
  return null;
}

const DOTS: Record<string, string> = {
  "": "dot",
  白ゴマ: "dot dot-open",
  丸: "dot dot-circle",
  白丸: "dot dot-open-circle",
  二重丸: "dot dot-double",
  蛇の目: "dot dot-double",
  黒三角: "dot dot-tri",
  白三角: "dot dot-open-tri",
};

/** Aozora emphasis named by a note body, e.g. `太字`, `白ゴマ傍点`. */
function azClass(name: string): string | null {
  if (name === "太字") return "az-b";
  const m = /^(.*)傍点$/.exec(name);
  return m ? (DOTS[m[1]] ?? "dot") : null;
}

export function visible(items: Inline[]): string {
  let out = "";
  for (const it of items) {
    if (it.t === "text") out += it.s;
    else if (it.t === "ruby") out += it.base;
    else if (it.t !== "note") out += visible(it.kids);
  }
  return out;
}

/** Wrap the last `target.length` visible characters of `out` (Aozora 前方参照). */
function wrapTail(out: Inline[], target: string, cls: string) {
  let k = out.length;
  let seen = 0;
  while (k > 0 && seen < target.length) {
    k--;
    seen += visible([out[k]]).length;
  }
  if (seen < target.length || !visible(out.slice(k)).endsWith(target)) return;
  const first = out[k];
  if (seen > target.length) {
    // Only split plain text with no escapes; anything else is left unstyled.
    if (first.t !== "text" || first.to - first.from !== first.s.length) return;
    const cut = seen - target.length;
    out.splice(
      k,
      1,
      { t: "text", s: first.s.slice(0, cut), from: first.from, to: first.from + cut },
      { t: "text", s: first.s.slice(cut), from: first.from + cut, to: first.to },
    );
    k++;
  }
  const kids = out.slice(k);
  out.splice(k, kids.length, { t: "az", cls, kids });
}

interface Frame {
  close: string;
  node: { kids: Inline[] };
  parent: Inline[];
  at: number;
}

export function parseInline(src: string, base = 0): Inline[] {
  const root: Inline[] = [];
  const stack: Frame[] = [];
  let out = root;
  const text = (s: string, from: number, to: number) => {
    const last = out[out.length - 1];
    if (last?.t === "text" && last.to === from + base) {
      last.s += s;
      last.to = to + base;
    } else out.push({ t: "text", s, from: from + base, to: to + base });
  };
  const open = (node: Inline & { kids: Inline[] }, close: string, at: number) => {
    out.push(node);
    stack.push({ close, node, parent: out, at });
    out = node.kids;
  };
  const closeTo = (idx: number) => {
    out = stack[idx].parent;
    stack.length = idx;
  };

  let i = 0;
  while (i < src.length) {
    const c = src.charCodeAt(i);
    if (c === BSLASH) {
      const n = readCp(src, i + 1);
      if (n) {
        text(String.fromCodePoint(n.cp), i, n.next);
        i = n.next;
      } else {
        text("\\", i, i + 1);
        i++;
      }
      continue;
    }
    if (c === 0xff3b && src.charCodeAt(i + 1) === 0xff03) {
      const end = src.indexOf("］", i + 2);
      if (end > 0) {
        const raw = src.slice(i, end + 1);
        const body = raw.slice(2, -1);
        const ref = /^「(.+)」[はに](.+)$/.exec(body);
        const closing = stack.findLastIndex((f) => f.close === raw);
        if (closing >= 0) {
          closeTo(closing);
          out.push({ t: "note", raw });
        } else if (ref && azClass(ref[2])) {
          wrapTail(out, ref[1], azClass(ref[2])!);
          out.push({ t: "note", raw });
        } else if (azClass(body)) {
          out.push({ t: "note", raw });
          open({ t: "az", cls: azClass(body)!, kids: [] }, `［＃${body}終わり］`, i);
        } else out.push({ t: "note", raw });
        i = end + 1;
        continue;
      }
    }
    if (c === STAR) {
      const m = src.charCodeAt(i + 1) === STAR ? "**" : "*";
      const idx = stack.findLastIndex((f) => f.close === m);
      if (idx >= 0) {
        closeTo(idx);
        i += m.length;
        continue;
      }
      const closer = src.indexOf(m, i + m.length);
      if (closer > i + m.length) {
        open({ t: m === "**" ? "b" : "i", kids: [] }, m, i);
        i += m.length;
        continue;
      }
    }
    if (c === LB || c === PIPE || c === FPIPE) {
      const r = c === LB ? tryBrace(src, i) : tryExplicit(src, i);
      if (r) {
        out.push({ t: "ruby", base: r.base, reading: r.reading, raw: src.slice(i, r.next) });
        i = r.next;
        continue;
      }
    }
    const cp = readCp(src, i)!;
    if (isKanji(cp.cp)) {
      let j = cp.next;
      while (j < src.length) {
        const k = readCp(src, j)!;
        if (!isKanji(k.cp)) break;
        j = k.next;
      }
      const r = tryReading(src, j);
      if (r) {
        out.push({ t: "ruby", base: src.slice(i, j), reading: r.reading, raw: src.slice(i, r.next) });
        i = r.next;
      } else {
        text(src.slice(i, j), i, j);
        i = j;
      }
      continue;
    }
    text(String.fromCodePoint(cp.cp), i, cp.next);
    i = cp.next;
  }

  // Openers whose closer never came (e.g. it was escaped) become literal again.
  while (stack.length) {
    const f = stack.pop()!;
    const pos = f.parent.indexOf(f.node as Inline);
    const marker: Inline[] = f.close.startsWith("［") ? [] : [{ t: "text", s: f.close, from: f.at + base, to: f.at + base + f.close.length }];
    f.parent.splice(pos, 1, ...marker, ...f.node.kids);
  }
  return root;
}

const PRE = /^(\t*)(?:(#{1,3}) |([-*]) |(［＃([0-9０-９]+)字下げ］))?/;
const ROW = /^\|.*\|[ \t]*$/;
const AZ_HEAD = /［＃(?:「[^」]*」は)?(?:同行|窓)?(大|中|小)見出し］/;

export function parseLine(src: string): Line {
  const m = PRE.exec(src)!;
  const tabs = m[1].length;
  const rest = src.slice(m[1].length);
  if (!m[2] && !m[3] && !m[4] && ROW.test(rest)) {
    return { pre: m[1], kind: "row", indent: tabs * 2, body: rest };
  }
  const pre = m[0];
  const body = src.slice(pre.length);
  let kind: Kind = m[2] ? (`h${m[2].length}` as Kind) : m[3] ? "li" : "p";
  const az = m[5] ? Number(m[5].replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))) : 0;
  if (kind === "p") {
    const h = AZ_HEAD.exec(body);
    if (h) kind = h[1] === "大" ? "h1" : h[1] === "中" ? "h2" : "h3";
  }
  return { pre, kind, indent: tabs * 2 + az, body };
}

/** Cells of a row body (`| a | b |`). A half-width pipe inside `{…}` or escaped does not split. */
export function splitCells(body: string, offset = 0): Cell[] {
  const cells: Cell[] = [];
  let start = 1;
  let i = 1;
  const push = (end: number) => {
    const raw = body.slice(start, end);
    const src = raw.trim();
    const l = src ? raw.slice(0, raw.indexOf(src)) : raw.slice(0, 1);
    cells.push({ l, r: raw.slice(l.length + src.length), src, at: offset + start + l.length });
  };
  while (i < body.length) {
    const c = body.charCodeAt(i);
    if (c === BSLASH) {
      i += 2;
      continue;
    }
    if (c === LB) {
      const r = tryBrace(body, i);
      if (r) {
        i = r.next;
        continue;
      }
    }
    if (c === PIPE) {
      push(i);
      start = i + 1;
    }
    i++;
  }
  return cells;
}

/** First and last line of the Aozora header notes block (between two dashed rules). */
export function metaRange(lines: string[]): [number, number] | null {
  const rule = /^-{20,}\s*$/;
  const a = lines.slice(0, 40).findIndex((l) => rule.test(l));
  if (a < 0) return null;
  for (let b = a + 1; b < Math.min(lines.length, a + 120); b++) if (rule.test(lines[b])) return [a, b];
  return null;
}

const BASE_SPECIAL = /[\\｜|《》{}*]/g;

export function escapeText(s: string): string {
  return s.replace(BASE_SPECIAL, "\\$&").replace(/［＃/g, "［\\＃");
}

export function formatRubyMarkup(base: string, reading: string): string {
  const r = reading.replace(/[\\》]/g, "\\$&");
  if (isPureKanji(base)) return `${base}《${r}》`;
  return `｜${escapeText(base)}《${r}》`;
}
