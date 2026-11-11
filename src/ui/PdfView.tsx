/**
 * The homework PDF, drawn with pdf.js so it can be pinch-zoomed like a native macOS viewer.
 * Pinching stretches the current bitmap at once; each page redraws sharp once the zoom settles.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

const CMAP_DIR = "/node_modules/pdfjs-dist/cmaps/";
// Lazy, and never inlined: each CMap stays a file, out of the startup bundle (and the CSP allows no data: fetches).
const cmaps = import.meta.glob<string>("/node_modules/pdfjs-dist/cmaps/*.bcmap", { query: "?url&no-inline", import: "default" });

/** pdf.js asks for the Adobe CMaps (needed for Japanese fonts) by file name; Vite gave each a hashed URL. */
class CMapFiles {
  async fetch({ filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const load = cmaps[CMAP_DIR + filename];
    if (!load) throw new Error(`no CMap ${filename}`);
    return new Uint8Array(await (await fetch(await load())).arrayBuffer());
  }
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Many PDFs map kanji like 日 and 文 to look-alike Kangxi radicals (⽇ ⽂), which Jisho can't find.
 * NFKC turns just those back into the normal kanji; the rest of the text is left alone.
 */
export const plainKanji = (s: string) => s.replace(/[\u2E80-\u2FDF]/g, (c) => c.normalize("NFKC"));

/** Safari's trackpad pinch event; not in the DOM typings. */
type Gesture = Event & { scale: number; clientX: number; clientY: number };

export function PdfView({ bytes }: { bytes: ArrayBuffer }) {
  const box = useRef<HTMLDivElement>(null);
  const [pdfjs, setPdfjs] = useState<PdfJs | null>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Where the pinch is, so that point stays under the fingers.
  const anchor = useRef<{ x: number; y: number; ratio: number } | null>(null);

  useEffect(() => {
    let task: { destroy(): Promise<void> } | null = null;
    let live = true;
    void (async () => {
      const lib = await import("pdfjs-dist");
      lib.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      if (!live) return;
      // pdf.js hands the bytes to its worker, so give it a copy. The app's CSP allows no wasm.
      const loading = lib.getDocument({ data: new Uint8Array(bytes.slice(0)), BinaryDataFactory: CMapFiles, useWorkerFetch: false, useWasm: false });
      task = loading;
      const loaded = await loading.promise;
      const all = await Promise.all(Array.from({ length: loaded.numPages }, (_, i) => loaded.getPage(i + 1)));
      if (!live) return;
      setPdfjs(lib);
      setPages(all);
    })().catch((e) => live && setError(String(e)));
    return () => {
      live = false;
      void task?.destroy();
    };
  }, [bytes]);

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current!;
    const zoomTo = (next: number, clientX: number, clientY: number) => {
      const from = zoomRef.current;
      const to = clamp(next);
      if (to === from) return;
      const r = el.getBoundingClientRect();
      anchor.current = { x: clientX - r.left, y: clientY - r.top, ratio: to / from };
      zoomRef.current = to;
      setZoom(to);
    };
    // Chromium (and the tests) report a trackpad pinch as a wheel event with ctrlKey.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomTo(zoomRef.current * Math.exp(-e.deltaY / 100), e.clientX, e.clientY);
    };
    // WebKit on macOS reports it as gesture events, with a scale relative to the start.
    let start = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      start = zoomRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Gesture;
      zoomTo(start * g.scale, g.clientX, g.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, []);

  useLayoutEffect(() => {
    const a = anchor.current;
    const el = box.current;
    if (!a || !el) return;
    anchor.current = null;
    el.scrollLeft = (el.scrollLeft + a.x) * a.ratio - a.x;
    el.scrollTop = (el.scrollTop + a.y) * a.ratio - a.y;
  }, [zoom]);

  // At zoom 1 the first page fills the pane's width.
  const fit = pages.length && width ? (width - 16) / pages[0].getViewport({ scale: 1 }).width : 0;

  return (
    <div
      className="pdf-view"
      ref={box}
      data-testid="pdf-view"
      data-zoom={zoom.toFixed(2)}
      onCopy={(e) => {
        const t = window.getSelection()?.toString();
        if (!t) return;
        e.preventDefault();
        e.clipboardData.setData("text/plain", plainKanji(t));
      }}
    >
      {error && <p className="dict-note">PDF を表示できません：{error}</p>}
      <div className="pdf-pages">
        {pdfjs && fit > 0 && pages.map((page, i) => <PdfPage key={i} page={page} scale={fit * zoom} pdfjs={pdfjs} />)}
      </div>
    </div>
  );
}

function PdfPage({ page, scale, pdfjs }: { page: PDFPageProxy; scale: number; pdfjs: PdfJs }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const size = page.getViewport({ scale });

  useEffect(() => {
    let render: { cancel(): void } | null = null;
    let layer: { cancel(): void } | null = null;
    const timer = setTimeout(() => {
      // Draw off screen and swap, so the page never flashes blank while zooming.
      const off = document.createElement("canvas");
      const viewport = page.getViewport({ scale: scale * devicePixelRatio });
      off.width = Math.floor(viewport.width);
      off.height = Math.floor(viewport.height);
      const task = page.render({ canvas: off, viewport });
      render = task;
      task.promise
        .then(() => {
          const c = canvas.current;
          if (!c) return;
          c.width = off.width;
          c.height = off.height;
          c.getContext("2d")!.drawImage(off, 0, 0);
        })
        .catch(() => {});
      // Invisible text over the drawing, so words can be selected and copied (to look them up).
      const div = text.current!;
      div.replaceChildren();
      div.style.setProperty("--scale-factor", String(scale));
      div.style.setProperty("--total-scale-factor", String(scale));
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: div, viewport: page.getViewport({ scale }) });
      layer = tl;
      tl.render().catch(() => {});
    }, 120);
    return () => {
      clearTimeout(timer);
      render?.cancel();
      layer?.cancel();
    };
  }, [page, scale, pdfjs]);

  return (
    <div className="pdf-page" style={{ width: size.width, height: size.height }}>
      <canvas ref={canvas} />
      <div ref={text} className="textLayer" />
    </div>
  );
}
