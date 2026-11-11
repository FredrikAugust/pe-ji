import { describe, expect, it } from "vitest";
import { ensureTextExtension, readPickedFile, sanitizeFilename } from "../src/lib/files";

describe("filenames", () => {
  it("matches the Rust extension rules", () => {
    expect(ensureTextExtension("日記")).toBe("日記.txt");
    expect(ensureTextExtension("日記.txt")).toBe("日記.txt");
    expect(ensureTextExtension("日記.TXT")).toBe("日記.TXT");
    expect(ensureTextExtension("notes.md")).toBe("notes.md");
    expect(ensureTextExtension("notes.MD")).toBe("notes.MD");
    expect(ensureTextExtension("  spaced  ")).toBe("spaced.txt");
    expect(ensureTextExtension("")).toBe("無題.txt");
    expect(ensureTextExtension("foo.markdown")).toBe("foo.markdown.txt");
    expect(ensureTextExtension(".txt")).toBe(".txt.txt");
  });

  it("rejects path separators", () => {
    expect(sanitizeFilename("a/b.txt")).toBeNull();
    expect(sanitizeFilename("a\\b.txt")).toBeNull();
    expect(sanitizeFilename("日記")).toBe("日記.txt");
    expect(sanitizeFilename("   ")).toBeNull();
  });
});

describe("readPickedFile", () => {
  it("strips a UTF-8 BOM", async () => {
    const body = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("漢字")]);
    const file = new File([body], "日記.txt", { type: "text/plain" });
    expect(await readPickedFile(file)).toBe("漢字");
  });

  it("rejects invalid UTF-8", async () => {
    const file = new File([new Uint8Array([0xff, 0xfe, 0x41])], "bad.txt");
    await expect(readPickedFile(file)).rejects.toThrow();
  });
});
