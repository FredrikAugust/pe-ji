import { describe, expect, it } from "vitest";
import { decodeText, encodeEol, ensureTextExtension, sanitizeFilename } from "../src/lib/files";

describe("filenames", () => {
  it("keeps .txt and .md, adds .txt otherwise", () => {
    expect(ensureTextExtension("日記")).toBe("日記.txt");
    expect(ensureTextExtension("日記.TXT")).toBe("日記.TXT");
    expect(ensureTextExtension("notes.md")).toBe("notes.md");
    expect(ensureTextExtension("  spaced  ")).toBe("spaced.txt");
    expect(ensureTextExtension("")).toBe("無題.txt");
    expect(ensureTextExtension("foo.markdown")).toBe("foo.markdown.txt");
  });

  it("rejects path separators", () => {
    expect(sanitizeFilename("a/b.txt")).toBeNull();
    expect(sanitizeFilename("a\\b.txt")).toBeNull();
    expect(sanitizeFilename("日記")).toBe("日記.txt");
    expect(sanitizeFilename("   ")).toBeNull();
  });
});

describe("decodeText", () => {
  it("strips a UTF-8 BOM and remembers CRLF", () => {
    const body = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("漢字\r\nかな")]);
    const doc = decodeText(body);
    expect(doc).toEqual({ text: "漢字\nかな", eol: "\r\n" });
    expect(encodeEol(doc.text, doc.eol)).toBe("漢字\r\nかな");
  });

  it("reads Shift_JIS, as Aozora Bunko ships it", () => {
    // 「吾輩《わがはい》」 in Shift_JIS.
    const sjis = new Uint8Array([0x8c, 0xe1, 0x94, 0x79, 0x81, 0x73, 0x82, 0xed, 0x82, 0xaa, 0x82, 0xcd, 0x82, 0xa2, 0x81, 0x74]);
    expect(decodeText(sjis).text).toBe("吾輩《わがはい》");
  });

  it("rejects bytes that are neither", () => {
    expect(() => decodeText(new Uint8Array([0xff, 0xff, 0xff]))).toThrow();
  });
});
