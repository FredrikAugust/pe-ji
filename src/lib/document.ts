export const FURI_MODES = ["show", "hide", "hover"] as const;
export type FuriMode = (typeof FURI_MODES)[number];

export const DEFAULT_FONT_SIZE = 18;
export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 32;

export function cycleFuri(mode: FuriMode): FuriMode {
  return FURI_MODES[(FURI_MODES.indexOf(mode) + 1) % FURI_MODES.length];
}

export function nextFontSize(size: number, dir: -1 | 0 | 1): number {
  if (dir === 0) return DEFAULT_FONT_SIZE;
  const next = size + dir * 2;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, next));
}

export function formatTitle(filename: string, dirty: boolean): string {
  return `${dirty ? "*" : ""}${filename} — ぴこぴこ作文帳`;
}

export function furiLabel(mode: FuriMode): string {
  if (mode === "show") return "表示";
  if (mode === "hide") return "非表示";
  return "ホバー";
}

export function isDirty(text: string, saved: string): boolean {
  return text !== saved;
}

/** Visible characters, ignoring line breaks. */
export function countChars(text: string): number {
  return Array.from(text.replace(/\r\n/g, "\n").replace(/\n/g, "")).length;
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.replace(/\r\n/g, "\n").split("\n").length;
}
