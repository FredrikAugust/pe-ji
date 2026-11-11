import { describe, expect, it } from "vitest";
import { align } from "../src/lib/furigana";
import { toEntries } from "../src/lib/dict";
import { withRecent } from "../src/lib/menus";

describe("furigana alignment", () => {
  it("puts the reading over the kanji only", () => {
    expect(align("食べる", "タベル", 5)).toEqual([[5, 6, "た"]]);
    expect(align("日本語", "ニホンゴ", 0)).toEqual([[0, 3, "にほんご"]]);
    expect(align("取り扱い", "トリアツカイ", 0)).toEqual([
      [0, 1, "と"],
      [2, 3, "あつか"],
    ]);
    expect(align("ひらがな", "ヒラガナ", 0)).toEqual([]);
  });

  it("falls back to the whole token when the kana do not line up", () => {
    expect(align("一ヶ月", "イッカゲツ", 0)).toEqual([[0, 3, "いっかげつ"]]);
  });
});

describe("Jisho entries", () => {
  it("keeps common, notes and other spellings", () => {
    const [e] = toEntries({
      data: [
        {
          is_common: true,
          japanese: [{ word: "為る", reading: "する" }, { reading: "する" }],
          jlpt: ["jlpt-n5"],
          senses: [{ english_definitions: ["to do"], parts_of_speech: ["Suru verb"], tags: ["Usually written using kana alone"], info: [] }],
        },
      ],
    });
    expect(e).toMatchObject({ word: "為る", reading: "する", common: true, jlpt: "N5", also: ["する"] });
    expect(e.senses[0].notes).toEqual(["Usually written using kana alone"]);
  });
});

describe("open recent", () => {
  it("lists recent files after 開く", () => {
    const file = withRecent(["/a/作文.txt"]).find((m) => m.id === "file")!;
    const at = file.items.findIndex((i) => i.command === "file.open");
    expect(file.items[at + 1]).toMatchObject({ command: "file.recent", path: "/a/作文.txt", label: "　作文.txt" });
  });
});

import { place, type Note } from "../src/lib/notes";

describe("notes", () => {
  const note = (quote: string, at: number): Note => ({ id: "n1", kind: "note", quote, label: quote, comment: "", at });
  it("follows the quote after edits", () => {
    expect(place("あいう学校です。学校", note("学校", 3))).toBe(3);
    expect(place("学校です。学校", note("学校", 6))).toBe(5);
    expect(place("です。", note("学校", 0))).toBe(-1);
    expect(place("です。", note("", 3))).toBe(3);
    expect(place("です。", note("", 99))).toBe(3);
  });
});
