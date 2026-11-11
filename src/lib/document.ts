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
  return `${dirty ? "*" : ""}${filename} — pe-ji`;
}

export function furiLabel(mode: FuriMode): string {
  if (mode === "show") return "表示";
  if (mode === "hide") return "非表示";
  return "ホバー";
}

export function isDirty(text: string, saved: string): boolean {
  return text !== saved;
}

/** Characters on the page: readings, notes, and markup are left out. Approximate for odd markup. */
export function countChars(text: string): number {
  const seen = text
    .replace(/\{([^|}\n]*)\|[^}\n]*\}/g, "$1")
    .replace(/［＃[^］\n]*］|《[^》\n]*》|^\t*(?:#{1,3} |[-*] )|[\\｜|*\t\n]/gm, "");
  return seen.length - (seen.match(/[\uD800-\uDBFF]/g)?.length ?? 0);
}

export function countLines(text: string): number {
  if (!text) return 0;
  let n = 1;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) n++;
  return n;
}
