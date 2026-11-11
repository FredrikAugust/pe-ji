import { describe, expect, it } from "vitest";
import {
  IME_SUPPRESS_MS,
  KEYMAP,
  cheatsheetRows,
  chordSignature,
  detectPlatform,
  formatChord,
  imeShouldIgnore,
  matchKey,
  type Chord,
  type KeyContext,
  type KeyLike,
  type Platform,
} from "../src/lib/keymap";

function ctx(over: Partial<KeyContext> = {}): KeyContext {
  return {
    platform: "other",
    target: "editor",
    overlay: "none",
    composing: false,
    suppressUntil: 0,
    now: 1_000,
    ...over,
  };
}

function eventFor(chord: Chord, platform: Platform, over: Partial<KeyLike> = {}): KeyLike {
  const letter = chord.key.length === 1 && /[a-z]/i.test(chord.key);
  const key = letter && chord.shift === true ? chord.key.toUpperCase() : chord.key;
  return {
    key,
    code: codeFor(chord.key),
    ctrlKey: platform === "other" && chord.mod,
    metaKey: platform === "mac" && chord.mod,
    altKey: chord.alt,
    shiftKey: chord.shift === true,
    ...over,
  };
}

function codeFor(key: string): string | undefined {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (key.startsWith("Arrow")) return key;
  if (key === "\\") return "Backslash";
  if (key === "/" || key === "?") return "Slash";
  if (key === "=" || key === "+") return "Equal";
  if (key === "-") return "Minus";
  return undefined;
}

describe("keymap", () => {
  it("has unique chords", () => {
    const sigs = KEYMAP.map((b) => chordSignature(b.chord));
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it("matches every binding on Linux and macOS", () => {
    for (const platform of ["other", "mac"] as const) {
      for (const binding of KEYMAP) {
        const target = binding.when === "outside-editor" ? "other" : "editor";
        const cmd = matchKey(eventFor(binding.chord, platform), ctx({ platform, target }));
        expect(cmd, `${platform} ${binding.label} ${binding.chord.key}`).toBe(binding.id);
      }
    }
  });

  it("ignores shortcuts while an IME is composing", () => {
    for (const binding of KEYMAP) {
      const event = eventFor(binding.chord, "other", { isComposing: true });
      expect(matchKey(event, ctx())).toBeNull();
      expect(matchKey(eventFor(binding.chord, "other", { keyCode: 229, key: "Process" }), ctx())).toBeNull();
      expect(matchKey(eventFor(binding.chord, "other"), ctx({ composing: true }))).toBeNull();
    }
  });

  it("suppresses the key that confirms an IME candidate", () => {
    const now = 5_000;
    expect(
      imeShouldIgnore({ key: "Enter", keyCode: 13 }, { composing: false, suppressUntil: now + IME_SUPPRESS_MS }, now + 10),
    ).toBe(true);
    expect(
      imeShouldIgnore({ key: "Enter" }, { composing: false, suppressUntil: now + IME_SUPPRESS_MS }, now + IME_SUPPRESS_MS),
    ).toBe(false);
    expect(imeShouldIgnore({ isComposing: true, key: "Enter" }, { composing: false, suppressUntil: 0 }, now)).toBe(true);
    expect(imeShouldIgnore({ key: "Process", keyCode: 229 }, { composing: false, suppressUntil: 0 }, now)).toBe(true);
  });

  it("does not treat Ctrl as Mod on macOS or Meta as Mod on Linux", () => {
    const save = KEYMAP.find((b) => b.id === "file.save")!;
    const macCtrl = eventFor(save.chord, "mac", { metaKey: false, ctrlKey: true });
    expect(matchKey(macCtrl, ctx({ platform: "mac" }))).toBeNull();
    const linuxMeta = eventFor(save.chord, "other", { ctrlKey: false, metaKey: true });
    expect(matchKey(linuxMeta, ctx({ platform: "other" }))).toBeNull();
  });

  it("types ? in the editor and opens the cheatsheet elsewhere", () => {
    const question: KeyLike = {
      key: "?",
      code: "Slash",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: true,
    };
    expect(matchKey(question, ctx({ target: "editor" }))).toBeNull();
    expect(matchKey(question, ctx({ target: "other" }))).toBe("help.cheatsheet");
  });

  it("lets Enter confirm a prompt and swallows other shortcuts", () => {
    const save = eventFor(KEYMAP.find((b) => b.id === "file.save")!.chord, "other");
    expect(matchKey(save, ctx({ overlay: "saveas" }))).toBeNull();
    expect(
      matchKey(
        { key: "Enter", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false },
        ctx({ overlay: "saveas" }),
      ),
    ).toBe("dialog.confirm");
    expect(
      matchKey(
        { key: "Escape", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false },
        ctx({ overlay: "confirm" }),
      ),
    ).toBe("dialog.cancel");
    expect(
      matchKey(
        { key: "Enter", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: true },
        ctx({ overlay: "saveas" }),
      ),
    ).toBeNull();
  });

  it("toggles the cheatsheet with Ctrl+/ and Escape", () => {
    const slash = eventFor(KEYMAP.find((b) => b.chord.key === "/")!.chord, "other");
    expect(matchKey(slash, ctx({ overlay: "cheatsheet" }))).toBe("help.cheatsheet");
    expect(
      matchKey(
        { key: "Escape", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false },
        ctx({ overlay: "cheatsheet" }),
      ),
    ).toBe("dialog.cancel");
  });

  it("formats shortcuts and lists every command in the cheatsheet", () => {
    expect(formatChord({ key: "s", mod: true, shift: true, alt: false }, "other")).toBe("Ctrl+Shift+S");
    expect(formatChord({ key: "s", mod: true, shift: false, alt: false }, "mac")).toBe("⌘+S");
    const rows = cheatsheetRows("other");
    for (const label of [
      "新規",
      "開く",
      "保存",
      "名前を付けて保存",
      "PDF出力",
      "ふりがなを切替",
      "文字を大きく",
      "文字を小さく",
      "文字サイズを戻す",
      "ショートカット一覧",
    ]) {
      expect(rows.some((row) => row.label === label)).toBe(true);
    }
    const redo = rows.find((row) => row.label === "やり直す");
    expect(redo?.keys).toContain("Ctrl+Shift+Z");
    expect(redo?.keys).toContain("Ctrl+Y");
  });

  it("detects macOS", () => {
    expect(detectPlatform("MacIntel", "")).toBe("mac");
    expect(detectPlatform("Linux x86_64", "")).toBe("other");
    expect(detectPlatform("", "Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe("mac");
  });
});
