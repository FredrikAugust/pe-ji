import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SAMPLE } from "../src/lib/sample";
import {
  applyReading,
  escapePlain,
  layoutSource,
  markupToPage,
  renderedIndexForSource,
  serializePage,
  sourceIndexForRendered,
  visibleCharCount,
  type PageNode,
} from "../src/lib/pageEdit";

interface Fixture {
  name: string;
  input: string;
}

const fixtures = (
  JSON.parse(readFileSync(new URL("../testdata/ruby_cases.json", import.meta.url), "utf8")) as { cases: Fixture[] }
).cases;

function reconstruct(text: string): string {
  const lines = layoutSource(text);
  let out = "";
  let cursor = 0;
  for (const line of lines) {
    expect(line.start).toBe(cursor);
    for (const piece of line.pieces) {
      expect(piece.start).toBe(cursor);
      out += text.slice(piece.start, piece.end);
      cursor = piece.end;
    }
    if (line.breakLen) {
      out += text.slice(cursor, cursor + line.breakLen);
      cursor += line.breakLen;
    }
  }
  expect(cursor).toBe(text.length);
  return out;
}

describe("page layout", () => {
  it("covers every fixture without gaps", () => {
    for (const fixture of fixtures) {
      expect(reconstruct(fixture.input), fixture.name).toBe(fixture.input);
    }
    expect(reconstruct(SAMPLE)).toBe(SAMPLE);
  });

  it("round-trips the sample and canonical ruby through the page tree", () => {
    expect(serializePage(markupToPage(SAMPLE)).text).toBe(SAMPLE);
    expect(serializePage(markupToPage("今日《きょう》は{晴れ|はれ}。")).text).toBe("今日《きょう》は｜晴れ《はれ》。");
    expect(serializePage(markupToPage("漢字《》")).text).toBe("漢字《》");
    expect(serializePage(markupToPage("a\n\nb")).text).toBe("a\n\nb");
    expect(serializePage(markupToPage("")).text).toBe("");
  });

  it("escapes markup characters typed as plain text", () => {
    expect(escapePlain("《a|b》")).toBe("\\《a\\|b\\》");
    const nodes: PageNode[] = [{ kind: "text", text: "《" }];
    expect(serializePage(nodes).text).toBe("\\《");
  });

  it("records selection marks in source offsets", () => {
    const nodes: PageNode[] = [
      {
        kind: "block",
        children: [
          { kind: "text", text: "ab" },
          { kind: "mark", id: "start" },
          { kind: "ruby", base: "漢字", reading: "かんじ" },
          { kind: "mark", id: "end" },
        ],
      },
    ];
    const { text, marks } = serializePage(nodes);
    expect(text).toBe("ab漢字《かんじ》");
    expect(marks.start).toBe(2);
    expect(marks.end).toBe(text.length);
  });

  it("maps escapes between source and rendered indexes", () => {
    const slice = "\\《x";
    expect(sourceIndexForRendered(slice, 0)).toBe(0);
    expect(sourceIndexForRendered(slice, 1)).toBe(2);
    expect(sourceIndexForRendered(slice, 2)).toBe(3);
    expect(renderedIndexForSource(slice, 0)).toBe(0);
    expect(renderedIndexForSource(slice, 1)).toBe(0);
    expect(renderedIndexForSource(slice, 2)).toBe(1);
  });

  it("replaces a visible selection with ruby and refuses a broken one", () => {
    const ok = applyReading("十一月の日記", 0, 3, "十一月", "じゅういちがつ");
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.text.startsWith("十一月《じゅういちがつ》")).toBe(true);
      expect(ok.cursor).toBe("十一月《じゅういちがつ》".length);
    }
    expect(applyReading("あ", 0, 0, "", "あ").ok).toBe(false);
    expect(applyReading("あ\nい", 0, 3, "あ\nい", "あ").ok).toBe(false);
    expect(applyReading("漢字", 0, 2, "漢字", "  ").ok).toBe(false);
    const again = applyReading("漢字《かんじ》", 0, "漢字《かんじ》".length, "漢字", "カンジ");
    expect(again.ok && again.text).toBe("漢字《カンジ》");
  });

  it("counts the characters on the page, not the markup", () => {
    expect(visibleCharCount("漢字《かんじ》\nあ")).toBe(3);
    expect(visibleCharCount("")).toBe(0);
  });
});
