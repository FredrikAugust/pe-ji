import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse, renderHtml, toLines } from "../src/lib/parser";

interface ExpectSeg {
  type: "text" | "ruby";
  text?: string;
  base?: string;
  reading?: string;
}

interface Case {
  name: string;
  input: string;
  segments: ExpectSeg[];
  html: string;
}

const fixture = JSON.parse(
  readFileSync(new URL("../testdata/ruby_cases.json", import.meta.url), "utf8"),
) as { cases: Case[] };

describe("furigana parser", () => {
  it("covers a thorough shared fixture set", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(40);
  });

  for (const item of fixture.cases) {
    it(item.name, () => {
      const got = parse(item.input);
      expect(got.map(strip)).toEqual(item.segments);
      expect(renderHtml(item.input)).toBe(item.html);
      for (const seg of got) {
        if (seg.type !== "ruby") continue;
        const raw = item.input.slice(seg.start, seg.end);
        const again = parse(raw);
        expect(again).toHaveLength(1);
        expect(again[0]).toMatchObject({ type: "ruby", base: seg.base, reading: seg.reading });
      }
    });
  }

  it("splits lines on LF and CRLF", () => {
    const lines = toLines(parse("朝《あさ》\r\n夜《よる》"));
    expect(lines).toHaveLength(2);
    expect(lines[0][0]).toMatchObject({ type: "ruby", base: "朝" });
    expect(lines[1][0]).toMatchObject({ type: "ruby", base: "夜" });
  });
});

function strip(seg: ReturnType<typeof parse>[number]): ExpectSeg {
  if (seg.type === "text") return { type: "text", text: seg.text };
  return { type: "ruby", base: seg.base, reading: seg.reading };
}
