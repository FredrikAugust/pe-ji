import { describe, expect, it } from "vitest";
import { parse } from "../src/lib/parser";
import { formatRubyMarkup, insertRuby, nextRuby, prevRuby } from "../src/lib/rubyEdit";

describe("ruby insert", () => {
  it("wraps a pure kanji selection in implicit markup", () => {
    const result = insertRuby("今日は晴れ", 0, 2, "きょう");
    expect(result).toMatchObject({ ok: true, text: "今日《きょう》は晴れ", cursor: "今日《きょう》".length });
  });

  it("uses an explicit pipe when the base is not pure kanji", () => {
    expect(formatRubyMarkup("食べ", "た")).toBe("｜食べ《た》");
    const result = insertRuby("食べる", 0, 2, "た");
    expect(result.ok && result.text.startsWith("｜食べ《た》")).toBe(true);
  });

  it("escapes special characters in the base and reading", () => {
    expect(formatRubyMarkup("A|B", "x》y")).toBe("｜A\\|B《x\\》y》");
    const again = parse("｜A\\|B《x\\》y》");
    expect(again).toMatchObject([{ type: "ruby", base: "A|B", reading: "x》y" }]);
  });

  it("rejects an empty selection, a multiline base, and an empty reading", () => {
    expect(insertRuby("漢字", 1, 1, "かんじ")).toMatchObject({ ok: false, reason: "empty-selection" });
    expect(insertRuby("漢\n字", 0, 3, "かんじ")).toMatchObject({ ok: false, reason: "multiline" });
    expect(insertRuby("漢字", 0, 2, "   ")).toMatchObject({ ok: false, reason: "empty-reading" });
  });

  it("trims the reading and places the cursor after the markup", () => {
    const result = insertRuby("あ漢字い", 1, 3, "  かんじ  ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("あ漢字《かんじ》い");
    expect(result.cursor).toBe("あ漢字《かんじ》".length);
  });
});

describe("ruby navigation", () => {
  const text = "ああ漢字《かんじ》いい{食べ|た}うう";

  it("jumps forward and backward without wrapping", () => {
    const first = nextRuby(text, 0);
    expect(text.slice(first!.start, first!.end)).toBe("漢字《かんじ》");
    const second = nextRuby(text, first!.start);
    expect(text.slice(second!.start, second!.end)).toBe("{食べ|た}");
    expect(nextRuby(text, second!.start)).toBeNull();
    expect(prevRuby(text, 0)).toBeNull();
    expect(prevRuby(text, second!.end)?.start).toBe(second!.start);
    expect(prevRuby(text, second!.start)?.start).toBe(first!.start);
  });

  it("treats a cursor inside a ruby as still on that ruby when going backward", () => {
    const first = nextRuby(text, 0)!;
    const inside = first.start + 1;
    expect(prevRuby(text, inside)?.start).toBe(first.start);
    expect(nextRuby(text, inside)?.start).toBeGreaterThan(first.start);
  });
});
