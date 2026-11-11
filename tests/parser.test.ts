import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { metaRange, parseInline, parseLine, splitCells, type Inline } from "../src/lib/parser";

interface Seg {
  type: "text" | "ruby";
  text?: string;
  base?: string;
  reading?: string;
}

const fixture = JSON.parse(readFileSync(new URL("../testdata/ruby_cases.json", import.meta.url), "utf8")) as {
  cases: { name: string; input: string; segments: Seg[] }[];
};

/** Ruby/text segments of a multi-line input, line breaks kept as text. */
function segments(input: string): Seg[] {
  const out: Seg[] = [];
  const text = (t: string) => {
    const last = out[out.length - 1];
    if (last?.type === "text") last.text += t;
    else if (t) out.push({ type: "text", text: t });
  };
  input.split(/(\r\n|\r|\n)/).forEach((part, i) => {
    if (i % 2) return text(part);
    for (const it of parseInline(part)) {
      if (it.t === "ruby") out.push({ type: "ruby", base: it.base, reading: it.reading });
      else if (it.t === "text") text(it.s);
    }
  });
  return out;
}

function shape(items: Inline[]): unknown[] {
  return items.map((it) =>
    it.t === "text" ? it.s : it.t === "ruby" ? `[${it.base}|${it.reading}]` : it.t === "note" ? "#" : { [it.t === "az" ? it.cls : it.t]: shape(it.kids) },
  );
}

describe("ruby grammar", () => {
  for (const item of fixture.cases) {
    it(item.name, () => {
      expect(segments(item.input)).toEqual(item.segments);
    });
  }
});

describe("lines", () => {
  it("reads block prefixes", () => {
    expect(parseLine("# 題")).toMatchObject({ kind: "h1", pre: "# ", body: "題" });
    expect(parseLine("### 題")).toMatchObject({ kind: "h3" });
    expect(parseLine("\t\t- 項目")).toMatchObject({ kind: "li", pre: "\t\t- ", indent: 4 });
    expect(parseLine("\t本文")).toMatchObject({ kind: "p", pre: "\t", indent: 2 });
    expect(parseLine("#題")).toMatchObject({ kind: "p", pre: "" });
    expect(parseLine("| a | b |")).toMatchObject({ kind: "row", pre: "" });
    expect(parseLine("|食べ《た》")).toMatchObject({ kind: "p" });
  });

  it("reads Aozora headings and indents", () => {
    expect(parseLine("第一章［＃「第一章」は大見出し］").kind).toBe("h1");
    expect(parseLine("［＃中見出し］二［＃中見出し終わり］").kind).toBe("h2");
    expect(parseLine("［＃３字下げ］三")).toMatchObject({ kind: "p", indent: 3, body: "三" });
  });

  it("splits table cells around brace ruby and escapes", () => {
    const cells = splitCells("| {漢字|かんじ} |a\\|b|  |");
    expect(cells.map((c) => c.src)).toEqual(["{漢字|かんじ}", "a\\|b", ""]);
    expect(cells[0]).toMatchObject({ l: " ", r: " ", at: 2 });
  });

  it("finds the Aozora header notes block", () => {
    const rule = "-".repeat(55);
    expect(metaRange(["題", "作者", "", rule, "《》：ルビ", rule, "本文"])).toEqual([3, 5]);
    expect(metaRange(["本文"])).toBeNull();
  });
});

describe("inline", () => {
  it("parses emphasis around ruby", () => {
    expect(shape(parseInline("a**太字《ふとじ》**と*斜め*"))).toEqual(["a", { b: ["[太字|ふとじ]"] }, "と", { i: ["斜め"] }]);
  });

  it("leaves unmatched or escaped markers literal", () => {
    expect(shape(parseInline("2*3"))).toEqual(["2*3"]);
    expect(shape(parseInline("**a\\**"))).toEqual(["**", "a**"]);
  });

  it("styles Aozora references and keeps unknown notes", () => {
    expect(shape(parseInline("吾輩《わがはい》は猫である［＃「猫である」に傍点］"))).toEqual([
      "[吾輩|わがはい]",
      "は",
      { dot: ["猫である"] },
      "#",
    ]);
    expect(shape(parseInline("［＃太字］強い［＃太字終わり］"))).toEqual(["#", { "az-b": ["強い"] }, "#"]);
    expect(shape(parseInline("※［＃「てへん＋劣」、第3水準1-84-77］"))).toEqual(["※", "#"]);
    expect(shape(parseInline("違う［＃「別」に傍点］"))).toEqual(["違う", "#"]);
  });
});
