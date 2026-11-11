import { describe, expect, it } from "vitest";
import {
  countChars,
  countLines,
  cycleFuri,
  formatTitle,
  furiLabel,
  isDirty,
  nextFontSize,
} from "../src/lib/document";

describe("document state", () => {
  it("cycles furigana modes", () => {
    expect(cycleFuri("show")).toBe("hide");
    expect(cycleFuri("hide")).toBe("hover");
    expect(cycleFuri("hover")).toBe("show");
    expect(furiLabel("hover")).toBe("ホバー");
  });

  it("clamps font size and resets to 18", () => {
    expect(nextFontSize(18, 1)).toBe(20);
    expect(nextFontSize(32, 1)).toBe(32);
    expect(nextFontSize(12, -1)).toBe(12);
    expect(nextFontSize(28, 0)).toBe(18);
  });

  it("marks a dirty title and counts characters without newlines", () => {
    expect(formatTitle("十一月の日記.txt", false)).toBe("十一月の日記.txt — ぴこぴこ作文帳");
    expect(formatTitle("無題.txt", true)).toBe("*無題.txt — ぴこぴこ作文帳");
    expect(isDirty("a", "a")).toBe(false);
    expect(isDirty("a", "b")).toBe(true);
    expect(countChars("あ\r\nい\n")).toBe(2);
    expect(countLines("あ\r\nい\n")).toBe(3);
    expect(countLines("")).toBe(0);
  });
});
