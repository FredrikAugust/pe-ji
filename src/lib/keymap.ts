/**
 * Central, data-driven keymap.
 *
 * Mod is ⌘ on macOS and Ctrl on Linux/Windows. Bindings stay in this table so
 * they can later be remapped without hunting through components.
 */

export type CommandId =
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.sample"
  | "file.close"
  | "file.pdf"
  | "file.recent"
  | "edit.selectAll"
  | "edit.undo"
  | "edit.redo"
  | "format.bold"
  | "format.italic"
  | "format.h1"
  | "format.h2"
  | "format.h3"
  | "format.body"
  | "format.bullet"
  | "format.indent"
  | "format.outdent"
  | "insert.table"
  | "dict.toggle"
  | "view.pdf"
  | "dict.lookup"
  | "view.furigana"
  | "view.furi.show"
  | "view.furi.hide"
  | "view.furi.hover"
  | "view.fontUp"
  | "view.fontDown"
  | "view.fontReset"
  | "help.cheatsheet"
  | "help.about"
  | "menu.file"
  | "menu.edit"
  | "menu.view"
  | "menu.format"
  | "menu.insert"
  | "menu.dict"
  | "menu.help"
  | "dialog.confirm"
  | "dialog.cancel";

export type Platform = "mac" | "other";

export interface Chord {
  key: string;
  mod: boolean;
  /** `"any"` ignores Shift (used for `?`, which is Shift+/). */
  shift: boolean | "any";
  alt: boolean;
}

export interface Binding {
  id: CommandId;
  group: string;
  label: string;
  chord: Chord;
  /** When false, the binding is omitted from the cheatsheet. */
  cheat?: boolean;
  when?: "global" | "outside-editor" | "editor";
}

export type Overlay = "none" | "saveas" | "confirm" | "cheatsheet" | "about";

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export interface KeyContext {
  platform: Platform;
  target: "editor" | "other";
  overlay: Overlay;
  composing: boolean;
  suppressUntil: number;
  now: number;
}

export const IME_SUPPRESS_MS = 50;

export interface ImeState {
  composing: boolean;
  suppressUntil: number;
}

/** True when a key event belongs to an IME and must not run a shortcut. */
export function imeShouldIgnore(
  e: { isComposing?: boolean; key?: string; keyCode?: number },
  state: ImeState,
  now: number,
): boolean {
  if (state.composing) return true;
  if (e.isComposing) return true;
  if (e.key === "Process") return true;
  if (e.keyCode === 229) return true;
  if (now < state.suppressUntil) return true;
  return false;
}

export const KEYMAP: Binding[] = [
  { id: "file.new", group: "ファイル", label: "新規", chord: { key: "n", mod: true, shift: false, alt: false } },
  { id: "file.open", group: "ファイル", label: "開く", chord: { key: "o", mod: true, shift: false, alt: false } },
  { id: "file.save", group: "ファイル", label: "保存", chord: { key: "s", mod: true, shift: false, alt: false } },
  { id: "file.saveAs", group: "ファイル", label: "名前を付けて保存", chord: { key: "s", mod: true, shift: true, alt: false } },
  { id: "file.pdf", group: "ファイル", label: "PDF出力", chord: { key: "p", mod: true, shift: false, alt: false } },
  { id: "file.close", group: "ファイル", label: "閉じる", chord: { key: "w", mod: true, shift: false, alt: false } },
  { id: "edit.undo", group: "編集", label: "元に戻す", chord: { key: "z", mod: true, shift: false, alt: false }, when: "editor" },
  { id: "edit.redo", group: "編集", label: "やり直す", chord: { key: "z", mod: true, shift: true, alt: false }, when: "editor" },
  { id: "edit.redo", group: "編集", label: "やり直す", chord: { key: "y", mod: true, shift: false, alt: false }, when: "editor" },
  { id: "format.bold", group: "書式", label: "太字", chord: { key: "b", mod: true, shift: false, alt: false } },
  { id: "format.italic", group: "書式", label: "斜体", chord: { key: "i", mod: true, shift: false, alt: false } },
  { id: "format.h1", group: "書式", label: "大見出し", chord: { key: "1", mod: true, shift: false, alt: false } },
  { id: "format.h2", group: "書式", label: "中見出し", chord: { key: "2", mod: true, shift: false, alt: false } },
  { id: "format.h3", group: "書式", label: "小見出し", chord: { key: "3", mod: true, shift: false, alt: false } },
  { id: "format.bullet", group: "書式", label: "箇条書き", chord: { key: "8", mod: true, shift: true, alt: false } },
  { id: "format.indent", group: "書式", label: "字下げ（表では次のセル）", chord: { key: "Tab", mod: false, shift: false, alt: false }, when: "editor" },
  { id: "format.outdent", group: "書式", label: "字下げを戻す", chord: { key: "Tab", mod: false, shift: true, alt: false }, when: "editor" },
  { id: "dict.lookup", group: "辞書", label: "選択中の語を辞書で引く", chord: { key: "d", mod: true, shift: false, alt: false } },
  { id: "view.furigana", group: "表示", label: "ふりがなを切替", chord: { key: "f", mod: true, shift: true, alt: false } },
  { id: "view.fontUp", group: "表示", label: "文字を大きく", chord: { key: "=", mod: true, shift: false, alt: false } },
  { id: "view.fontUp", group: "表示", label: "文字を大きく", chord: { key: "+", mod: true, shift: true, alt: false } },
  { id: "view.fontDown", group: "表示", label: "文字を小さく", chord: { key: "-", mod: true, shift: false, alt: false } },
  { id: "view.fontReset", group: "表示", label: "文字サイズを戻す", chord: { key: "0", mod: true, shift: false, alt: false } },
  { id: "help.cheatsheet", group: "ヘルプ", label: "ショートカット一覧", chord: { key: "/", mod: true, shift: false, alt: false } },
  {
    id: "help.cheatsheet",
    group: "ヘルプ",
    label: "ショートカット一覧",
    chord: { key: "?", mod: false, shift: "any", alt: false },
    when: "outside-editor",
  },
  { id: "menu.file", group: "メニュー", label: "ファイルメニュー", chord: { key: "f", mod: false, shift: false, alt: true } },
  { id: "menu.edit", group: "メニュー", label: "編集メニュー", chord: { key: "e", mod: false, shift: false, alt: true } },
  { id: "menu.view", group: "メニュー", label: "表示メニュー", chord: { key: "v", mod: false, shift: false, alt: true } },
  { id: "menu.format", group: "メニュー", label: "書式メニュー", chord: { key: "o", mod: false, shift: false, alt: true } },
  { id: "menu.insert", group: "メニュー", label: "挿入メニュー", chord: { key: "i", mod: false, shift: false, alt: true } },
  { id: "menu.dict", group: "メニュー", label: "辞書メニュー", chord: { key: "d", mod: false, shift: false, alt: true } },
  { id: "menu.help", group: "メニュー", label: "ヘルプメニュー", chord: { key: "h", mod: false, shift: false, alt: true } },
];

const PROMPTS: Overlay[] = ["saveas", "confirm", "about"];

export function matchKey(e: KeyLike, ctx: KeyContext): CommandId | null {
  if (imeShouldIgnore(e, { composing: ctx.composing, suppressUntil: ctx.suppressUntil }, ctx.now)) {
    return null;
  }
  const { mod, other } = commandModifiers(e, ctx.platform);
  if (PROMPTS.includes(ctx.overlay)) {
    if (e.key === "Escape" && !mod && !other && !e.altKey && !e.shiftKey) return "dialog.cancel";
    if (e.key === "Enter" && !mod && !other && !e.altKey && !e.shiftKey) return "dialog.confirm";
    return null;
  }
  if (ctx.overlay === "cheatsheet") {
    if (e.key === "Escape" && !mod && !other && !e.altKey) return "dialog.cancel";
    if (chordMatches(e, { key: "/", mod: true, shift: false, alt: false }, mod, other)) return "help.cheatsheet";
    if (e.key === "?" && !mod && !other && !e.altKey && ctx.target !== "editor") return "help.cheatsheet";
    return null;
  }
  for (const binding of KEYMAP) {
    if (binding.when === "outside-editor" && ctx.target === "editor") continue;
    if (binding.when === "editor" && ctx.target !== "editor") continue;
    if (chordMatches(e, binding.chord, mod, other)) return binding.id;
  }
  return null;
}

function commandModifiers(e: KeyLike, platform: Platform): { mod: boolean; other: boolean } {
  if (platform === "mac") return { mod: e.metaKey, other: e.ctrlKey };
  return { mod: e.ctrlKey, other: e.metaKey };
}

function chordMatches(e: KeyLike, chord: Chord, mod: boolean, other: boolean): boolean {
  if (chord.mod !== mod) return false;
  if (other) return false;
  if (chord.alt !== e.altKey) return false;
  if (chord.shift !== "any" && chord.shift !== e.shiftKey) return false;
  return keyMatches(e, chord.key);
}

function keyMatches(e: KeyLike, expected: string): boolean {
  if (expected === "\\") {
    return e.key === "\\" || e.key === "¥" || e.code === "Backslash" || e.code === "IntlYen";
  }
  if (expected === "?" || expected === "/" || expected === "+" || expected === "=" || expected === "-") {
    return e.key === expected;
  }
  if (e.key.toLowerCase() === expected.toLowerCase()) return true;
  if (e.key === expected) return true;
  const code = codeFor(expected);
  return !!code && e.code === code;
}

function codeFor(expected: string): string | null {
  if (/^[a-z]$/i.test(expected)) return `Key${expected.toUpperCase()}`;
  if (/^[0-9]$/.test(expected)) return `Digit${expected}`;
  if (expected.startsWith("Arrow")) return expected;
  return null;
}

export function chordSignature(chord: Chord): string {
  const shift = chord.shift === "any" ? "*" : chord.shift ? "1" : "0";
  return `${chord.mod ? "M" : ""}${chord.alt ? "A" : ""}${shift}:${chord.key}`;
}

const KEY_NAMES: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  "\\": "\\",
};

export function formatChord(chord: Chord, platform: Platform): string {
  const parts: string[] = [];
  if (chord.mod) parts.push(platform === "mac" ? "⌘" : "Ctrl");
  if (chord.alt) parts.push(platform === "mac" ? "⌥" : "Alt");
  if (chord.shift === true) parts.push(platform === "mac" ? "⇧" : "Shift");
  const pretty =
    KEY_NAMES[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  parts.push(pretty);
  return parts.join("+");
}

export function shortcutFor(id: CommandId, platform: Platform): string {
  const hits = KEYMAP.filter((b) => b.id === id);
  if (!hits.length) return "";
  return hits.map((b) => formatChord(b.chord, platform)).join(" / ");
}

export interface CheatRow {
  group: string;
  label: string;
  keys: string;
}

export function cheatsheetRows(platform: Platform): CheatRow[] {
  const rows: CheatRow[] = [];
  const seen = new Map<string, CheatRow>();
  for (const binding of KEYMAP) {
    if (binding.cheat === false) continue;
    const keys = formatChord(binding.chord, platform);
    const existing = seen.get(binding.id);
    if (existing) {
      if (!existing.keys.split(" / ").includes(keys)) existing.keys += ` / ${keys}`;
      continue;
    }
    const row = { group: binding.group, label: binding.label, keys };
    seen.set(binding.id, row);
    rows.push(row);
  }
  return rows;
}

export function detectPlatform(platform = "", userAgent = ""): Platform {
  const p = platform.toLowerCase();
  const ua = userAgent.toLowerCase();
  if (p.includes("mac") || ua.includes("mac os")) return "mac";
  return "other";
}

export function modLabel(platform: Platform): string {
  return platform === "mac" ? "⌘" : "Ctrl";
}
