import { describe, expect, it } from "vitest";
import { indent, insertTable, mapLines, outdentPrefix, rowEnter, setBlock } from "../src/lib/edit";
import { formatRubyMarkup } from "../src/lib/parser";

describe("ruby markup", () => {
  it("uses the implicit form for pure kanji and a pipe otherwise", () => {
    expect(formatRubyMarkup("漢字", "かんじ")).toBe("漢字《かんじ》");
    expect(formatRubyMarkup("食べ", "た")).toBe("｜食べ《た》");
    expect(formatRubyMarkup("a|b", "x》")).toBe("｜a\\|b《x\\》》");
  });
});

describe("block commands", () => {
  it("sets and toggles headings and bullets on every touched line", () => {
    expect(setBlock("a\nb", 0, 3, "h1")?.text).toBe("# a\n# b");
    expect(setBlock("# a\n# b", 0, 7, "h1")?.text).toBe("a\nb");
    expect(setBlock("\t# a", 0, 0, "li")?.text).toBe("\t- a");
  });

  it("keeps the caret on the same character", () => {
    expect(setBlock("ab", 1, 1, "h2")).toEqual({ text: "## ab", start: 4, end: 4 });
    expect(mapLines("x\n- ab", 4, 4, () => "")).toEqual({ text: "x\nab", start: 2, end: 2 });
  });

  it("indents with tabs and outdents bullet first", () => {
    expect(indent("a\n- b", 0, 4, 1)?.text).toBe("\ta\n\t- b");
    expect(indent("\ta\nb", 0, 3, -1)?.text).toBe("a\nb");
    expect(indent("a", 0, 0, -1)).toBeNull();
    expect(outdentPrefix({ pre: "\t- ", kind: "li", indent: 2, body: "" })).toBe("\t");
    expect(outdentPrefix({ pre: "\t\t", kind: "p", indent: 4, body: "" })).toBe("\t");
  });
});

describe("tables", () => {
  it("inserts a table below the caret line and lands in the first cell", () => {
    expect(insertTable("abc", 1)).toEqual({ text: "abc\n|  |  |  |\n|  |  |  |\n", start: 6, end: 6 });
    expect(insertTable("", 0).text).toBe("|  |  |  |\n|  |  |  |\n");
  });

  it("adds a row on Enter and leaves the table from an empty row", () => {
    expect(rowEnter("| a | b |", 3).text).toBe("| a | b |\n|  |  |");
    expect(rowEnter("| a |\n|  |", 8).text).toBe("| a |\n");
  });
});
