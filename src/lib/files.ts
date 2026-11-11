/** Browser / Tauri file helpers. The Rust side only moves bytes. */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Keep `.txt` / `.md`. Add `.txt` when the name has no extension. */
export function ensureTextExtension(name: string): string {
  const base = name.trim();
  if (!base) return "無題.txt";
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const ext = base.slice(dot + 1).toLowerCase();
    if (ext === "txt" || ext === "md") return base;
  }
  return `${base}.txt`;
}

export function sanitizeFilename(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (/[\\/\u0000]/.test(trimmed)) return null;
  return ensureTextExtension(trimmed);
}

export interface Decoded {
  text: string;
  /** Line ending to write back. */
  eol: "\n" | "\r\n";
}

/** UTF-8 (BOM stripped), else Shift_JIS, which is what Aozora Bunko ships. Throws on anything else. */
export function decodeText(bytes: Uint8Array): Decoded {
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    raw = new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return { text: raw.replace(/\r\n?/g, "\n"), eol: raw.includes("\r\n") ? "\r\n" : "\n" };
}

export function encodeEol(text: string, eol: Decoded["eol"]): string {
  return eol === "\n" ? text : text.replace(/\n/g, eol);
}

export function downloadText(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || "無題.txt";
}
