/** Browser / Tauri file helpers. The Rust side owns real disk IO. */

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

/** Read a picked file as UTF-8, stripping a leading BOM. */
export async function readPickedFile(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) start = 3;
  return new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(start));
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || "無題.txt";
}
