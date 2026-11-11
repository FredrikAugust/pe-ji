import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  countChars,
  countLines,
  cycleFuri,
  formatTitle,
  furiLabel,
  isDirty,
  nextFontSize,
  FURI_MODES,
  type FuriMode,
} from "./lib/document";
import { insertTable, replace, setBlock, type Block } from "./lib/edit";
import {
  firstEnabledIndex,
  menuCommand,
  popupContextMenu,
  setNativeMenu,
  withRecent,
  type MenuId,
  type MenuItem,
} from "./lib/menus";
import {
  basename,
  decodeText,
  downloadText,
  encodeEol,
  isTauri,
  sanitizeFilename,
  type Decoded,
} from "./lib/files";
import {
  IME_SUPPRESS_MS,
  KEYMAP,
  cheatsheetRows,
  detectPlatform,
  imeShouldIgnore,
  matchKey,
  modLabel,
  shortcutFor,
  type CommandId,
  type KeyContext,
  type Overlay,
  type Platform,
} from "./lib/keymap";
import type { Kind } from "./lib/parser";
import { SAMPLE, SAMPLE_NAME, UNTITLED_NAME } from "./lib/sample";
import { Dict } from "./ui/Dict";
import { Translate } from "./ui/Translate";
import { Notes } from "./ui/Notes";
import { place, type Note } from "./lib/notes";
import { connectRelay, type RelayStatus } from "./lib/relay";
import { Page, type PageHandle } from "./ui/Page";

const HIT_KEY = "pico-sakubun-hits";
const HIT_SESSION = "pico-sakubun-hit-session";
const FURI_KEY = "pico.furigana";
const AI_KEY = "pico.ai";
const PDF_WIDTH_KEY = "pico.pdfWidth";
const RELAY_KEY = "pico.relay";
const RELAY_LABEL: Record<RelayStatus, string> = {
  connecting: "接続中…",
  online: "接続しています",
  offline: "つながりません（再試行中）",
  replaced: "別のパソコンが使っています",
};
const RECENT_KEY = "pico.recent";

export function App() {
  const platform: Platform =
    typeof navigator === "undefined"
      ? "other"
      : detectPlatform(navigator.platform, navigator.userAgent);

  const [text, setText] = useState(SAMPLE);
  const [doc, setDoc] = useState({ text: SAMPLE });
  const [saved, setSaved] = useState(SAMPLE);
  const [filename, setFilename] = useState(SAMPLE_NAME);
  const [path, setPath] = useState<string | null>(null);
  const [furi, setFuri] = useState<FuriMode>(() => {
    try {
      return (FURI_MODES as readonly string[]).includes(localStorage.getItem(FURI_KEY) ?? "")
        ? (localStorage.getItem(FURI_KEY) as FuriMode)
        : "show";
    } catch {
      return "show";
    }
  });
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const menus = useMemo(() => withRecent(recent), [recent]);
  const menusRef = useRef(menus);
  menusRef.current = menus;
  const [fontSize, setFontSize] = useState(18);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [saveAsDraft, setSaveAsDraft] = useState("");
  const [imeOn, setImeOn] = useState(false);
  const [hits, setHits] = useState("00013842");
  const [eol, setEol] = useState<Decoded["eol"]>("\n");
  const [kind, setKind] = useState<Kind>("p");
  const [dictOpen, setDictOpen] = useState(true);
  const [dictSeed, setDictSeed] = useState<{ q: string; n: number } | null>(
    null,
  );

  const textRef = useRef(text);
  const savedRef = useRef(saved);
  const filenameRef = useRef(filename);
  const pathRef = useRef(path);
  const eolRef = useRef(eol);
  const overlayRef = useRef(overlay);
  const openMenuRef = useRef(openMenu);
  const menuIndexRef = useRef(menuIndex);
  const composingRef = useRef(false);
  const suppressUntilRef = useRef(0);
  const pendingRef = useRef<(() => void) | null>(null);
  const pageRef = useRef<PageHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [trOpen, setTrOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [ai, setAi] = useState<{ url: string; token: string } | null>(null);
  const [relay, setRelay] = useState<{ url: string; key: string } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(RELAY_KEY) ?? "null") as { url: string; key: string } | null;
    } catch {
      return null;
    }
  });
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null);
  const [relayEpoch, setRelayEpoch] = useState(0);
  const relayFormRef = useRef<HTMLFormElement>(null);
  const [trSeed, setTrSeed] = useState<{ q: string; n: number } | null>(null);
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>(null);

  const showPdf = useCallback((bytes: BlobPart, name: string) => {
    setPdf((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { url: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), name };
    });
  }, []);

  const openPdf = useCallback(async () => {
    if (!isTauri()) {
      pdfRef.current?.click();
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (typeof path !== "string") return;
    const { invoke } = await import("@tauri-apps/api/core");
    showPdf(await invoke<ArrayBuffer>("read_document", { path }), basename(path));
  }, [showPdf]);

  const [pdfWidth, setPdfWidth] = useState(() => {
    try {
      return Number(localStorage.getItem(PDF_WIDTH_KEY)) || 480;
    } catch {
      return 480;
    }
  });
  const resizePdf = (w: number) => setPdfWidth(Math.round(Math.min(Math.max(w, 200), window.innerWidth - 360)));
  const savePdfWidth = () => {
    try {
      localStorage.setItem(PDF_WIDTH_KEY, String(pdfWidth));
    } catch {
      // Width is a convenience only.
    }
  };
  const saveAsInputRef = useRef<HTMLInputElement>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<(cmd: CommandId) => void>(() => {});
  const statusTimer = useRef(0);

  textRef.current = text;
  savedRef.current = saved;
  filenameRef.current = filename;
  pathRef.current = path;
  eolRef.current = eol;
  overlayRef.current = overlay;
  openMenuRef.current = openMenu;
  menuIndexRef.current = menuIndex;

  const dirty = isDirty(text, saved);
  const title = formatTitle(filename, dirty);

  const flash = useCallback((message: string) => {
    setStatus(message);
    window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(""), 4000);
  }, []);

  const loadDoc = useCallback(
    (doc: Decoded, name: string, nextPath: string | null, message: string) => {
      setDoc({ text: doc.text });
      setText(doc.text);
      setSaved(doc.text);
      setEol(doc.eol);
      setFilename(name);
      setPath(nextPath);
      setOverlay("none");
      setOpenMenu(null);
      flash(message);
      queueMicrotask(() => pageRef.current?.focus());
    },
    [flash],
  );

  const saveBrowser = useCallback(
    (name: string) => {
      const body = textRef.current;
      downloadText(name, encodeEol(body, eolRef.current));
      setFilename(name);
      setSaved(body);
      flash("保存しました");
    },
    [flash],
  );

  const tauriWrite = useCallback(
    async (target: string) => {
      // Read once: typing during the write must stay dirty.
      const body = textRef.current;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_document", {
        path: target,
        contents: encodeEol(body, eolRef.current),
      });
      setPath(target);
      setFilename(basename(target));
      setSaved(body);
      flash("保存しました");
    },
    [flash],
  );

  const failSave = useCallback(
    (err: unknown) => {
      flash(`保存できませんでした：${String(err)}`);
      return false;
    },
    [flash],
  );

  const tauriSaveAs = useCallback(async (): Promise<boolean> => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const picked = await save({
      defaultPath: filenameRef.current,
      filters: [{ name: "作文", extensions: ["txt", "md"] }],
    });
    if (typeof picked !== "string") return false;
    try {
      await tauriWrite(picked);
      return true;
    } catch (err) {
      return failSave(err);
    }
  }, [failSave, tauriWrite]);

  const save = useCallback(async (): Promise<boolean> => {
    if (isTauri()) {
      if (!pathRef.current) return tauriSaveAs();
      try {
        await tauriWrite(pathRef.current);
        return true;
      } catch (err) {
        return failSave(err);
      }
    }
    saveBrowser(filenameRef.current);
    return true;
  }, [failSave, saveBrowser, tauriSaveAs, tauriWrite]);

  const beginSaveAs = useCallback(() => {
    if (isTauri()) {
      void tauriSaveAs();
      return;
    }
    setSaveAsDraft(filenameRef.current.replace(/\.(txt|md)$/i, ""));
    setOpenMenu(null);
    setOverlay("saveas");
  }, [tauriSaveAs]);

  const commitSaveAs = useCallback(() => {
    const name = sanitizeFilename(saveAsInputRef.current?.value ?? saveAsDraft);
    if (!name) {
      flash("ファイル名が正しくありません");
      return;
    }
    saveBrowser(name);
    setOverlay("none");
  }, [flash, saveAsDraft, saveBrowser]);

  const remember = useCallback((path: string) => {
    setRecent((list) => {
      const next = [path, ...list.filter((p) => p !== path)].slice(0, 10);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // Recent files are a convenience; the list just won't survive a restart.
      }
      return next;
    });
  }, []);

  const openPath = useCallback(
    async (path: string) => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const bytes = await invoke<ArrayBuffer>("read_document", { path });
        loadDoc(decodeText(new Uint8Array(bytes)), basename(path), path, "開きました");
        remember(path);
      } catch (err) {
        flash(err instanceof TypeError ? "UTF-8 でも Shift_JIS でもありません" : `開けませんでした：${String(err)}`);
      }
    },
    [flash, loadDoc, remember],
  );

  const doOpen = useCallback(async () => {
    if (isTauri()) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: false,
        filters: [{ name: "作文", extensions: ["txt", "md"] }],
      });
      if (typeof picked === "string") await openPath(picked);
      return;
    }
    fileRef.current?.click();
  }, [openPath]);

  const destroyWindow = useCallback(async () => {
    if (!isTauri()) {
      window.close();
      return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("force_close");
  }, []);

  const guard = useCallback((action: () => void) => {
    if (!isDirty(textRef.current, savedRef.current)) {
      action();
      return;
    }
    pendingRef.current = action;
    setOpenMenu(null);
    setOverlay("confirm");
  }, []);

  const block = useCallback(
    (k: Block) => pageRef.current?.edit((t, s2, e) => setBlock(t, s2, e, k)),
    [],
  );

  const run = useCallback(
    (cmd: CommandId) => {
      if (cmd.startsWith("menu.")) {
        const id = cmd.slice("menu.".length) as MenuId;
        setOpenMenu((cur) => {
          const next = cur === id ? null : id;
          if (next) {
            const menu = menusRef.current.find((item) => item.id === next);
            if (menu) setMenuIndex(Math.max(0, firstEnabledIndex(menu)));
          }
          return next;
        });
        return;
      }
      setOpenMenu(null);
      switch (cmd) {
        case "file.new":
          guard(() =>
            loadDoc(
              { text: "", eol: "\n" },
              UNTITLED_NAME,
              null,
              "新しい作文を開きました",
            ),
          );
          break;
        case "file.open":
          guard(() => {
            void doOpen();
          });
          break;
        case "file.save":
          void save();
          break;
        case "file.saveAs":
          beginSaveAs();
          break;
        case "file.sample":
          guard(() =>
            loadDoc(
              { text: SAMPLE, eol: "\n" },
              SAMPLE_NAME,
              null,
              "サンプルを開きました",
            ),
          );
          break;
        case "file.pdf":
          window.print();
          break;
        case "file.close":
          guard(() => {
            void destroyWindow();
          });
          break;
        case "edit.selectAll":
          pageRef.current?.selectAll();
          break;
        case "edit.undo":
          pageRef.current?.undo(-1);
          break;
        case "edit.redo":
          pageRef.current?.undo(1);
          break;
        case "format.bold":
          pageRef.current?.format("bold");
          break;
        case "format.italic":
          pageRef.current?.format("italic");
          break;
        case "format.h1":
        case "format.h2":
        case "format.h3":
          block(cmd.slice("format.".length) as Block);
          break;
        case "format.body":
          block("p");
          break;
        case "format.bullet":
          block("li");
          break;
        case "format.indent":
          pageRef.current?.tab(1);
          break;
        case "format.outdent":
          pageRef.current?.tab(-1);
          break;
        case "insert.table":
          pageRef.current?.edit((t, start) => insertTable(t, start));
          break;
        case "view.pdf":
          if (pdf) {
            URL.revokeObjectURL(pdf.url);
            setPdf(null);
          } else void openPdf();
          break;
        case "dict.toggle":
          setDictOpen((open) => !open);
          break;
        case "dict.lookup": {
          const base = pageRef.current?.selection()?.base.trim() ?? "";
          setDictOpen(true);
          setDictSeed((prev) => ({ q: base, n: (prev?.n ?? 0) + 1 }));
          break;
        }
        case "notes.toggle":
          setNotesOpen((open) => !open);
          break;
        case "ai.connect":
          if (!isTauri()) {
            flash("AI 接続はデスクトップ版だけです");
            break;
          }
          void import("@tauri-apps/api/core")
            .then(({ invoke }) => invoke<{ url: string; token: string }>("mcp_start"))
            .then((info) => {
              setAi(info);
              setOverlay("ai");
              try {
                localStorage.setItem(AI_KEY, "1");
              } catch {
                // Auto-connect next time is a convenience only.
              }
            })
            .catch((err) => flash(`AI 接続を開始できませんでした：${String(err)}`));
          break;
        case "translate.toggle":
          setTrOpen((open) => !open);
          break;
        case "translate.selection": {
          let q = pageRef.current?.selection()?.base.trim() ?? "";
          if (!q) {
            // Nothing selected: the caret's line, readings left out.
            const node = window.getSelection()?.anchorNode;
            const line = (node instanceof Element ? node : node?.parentElement)?.closest(".ln")?.cloneNode(true) as HTMLElement | undefined;
            line?.querySelectorAll("rt, rp, .nt").forEach((n) => n.remove());
            q = line?.textContent?.trim() ?? "";
          }
          setTrOpen(true);
          setTrSeed((prev) => ({ q, n: (prev?.n ?? 0) + 1 }));
          break;
        }
        case "view.furigana":
          setFuri((mode) => cycleFuri(mode));
          break;
        case "view.furi.show":
          setFuri("show");
          break;
        case "view.furi.hide":
          setFuri("hide");
          break;
        case "view.furi.hover":
          setFuri("hover");
          break;
        case "view.fontUp":
          setFontSize((size) => nextFontSize(size, 1));
          break;
        case "view.fontDown":
          setFontSize((size) => nextFontSize(size, -1));
          break;
        case "view.fontReset":
          setFontSize(nextFontSize(18, 0));
          break;
        case "help.cheatsheet":
          setOverlay((current) =>
            current === "cheatsheet" ? "none" : "cheatsheet",
          );
          break;
        case "help.about":
          setOverlay("about");
          break;
        case "dialog.cancel":
          pendingRef.current = null;
          setOverlay("none");
          break;
        case "dialog.confirm":
          if (overlayRef.current === "saveas") commitSaveAs();
          else if (overlayRef.current === "ai") relayFormRef.current?.requestSubmit();
          else if (overlayRef.current === "confirm") {
            void (async () => {
              const ok = await save();
              if (!ok) return;
              const action = pendingRef.current;
              pendingRef.current = null;
              setOverlay("none");
              action?.();
            })();
          } else if (
            overlayRef.current === "about" ||
            overlayRef.current === "cheatsheet"
          ) {
            setOverlay("none");
          }
          break;
        default:
          break;
      }
    },
    [
      beginSaveAs,
      block,
      commitSaveAs,
      destroyWindow,
      doOpen,
      guard,
      loadDoc,
      openPdf,
      pdf,
      save,
    ],
  );
  runRef.current = run;

  /** A file dropped on the window: a PDF opens beside the page, .txt/.md opens for editing. */
  const dropped = useRef<(name: string, read: () => Promise<ArrayBuffer>, path?: string, file?: File) => void>(() => {});
  dropped.current = (name, read, path, file) => {
    if (/\.pdf$/i.test(name)) void read().then((b) => showPdf(b, basename(name)));
    else if (!/\.(txt|md)$/i.test(name)) flash("開けるのは .txt・.md・.pdf です");
    else if (path) guard(() => void openPath(path));
    else if (file) guard(() => void openFile(file));
  };

  useEffect(() => {
    if (isTauri()) {
      let stop: (() => void) | null = null;
      let done = false;
      void Promise.all([import("@tauri-apps/api/webview"), import("@tauri-apps/api/core")]).then(([{ getCurrentWebview }, { invoke }]) =>
        getCurrentWebview()
          .onDragDropEvent((e) => {
            if (e.payload.type !== "drop") return;
            const path = e.payload.paths[0];
            if (path) dropped.current(path, () => invoke<ArrayBuffer>("read_document", { path }), path);
          })
          .then((un) => (done ? un() : (stop = un))),
      );
      return () => {
        done = true;
        stop?.();
      };
    }
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      e.preventDefault();
      dropped.current(file.name, () => file.arrayBuffer(), undefined, file);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const pick = useCallback(
    (item: MenuItem) => {
      const path = item.path;
      if (path) {
        setOpenMenu(null);
        guard(() => void openPath(path));
      } else if (item.command) run(item.command);
    },
    [guard, openPath, run],
  );
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useEffect(() => {
    if (isTauri()) void setNativeMenu(menus, (item) => pickRef.current(item));
  }, [menus]);

  useEffect(() => {
    try {
      localStorage.setItem(FURI_KEY, furi);
    } catch {
      // Remembering the mode is a convenience only.
    }
  }, [furi]);

  // --- AI (MCP): Rust serves reads from a snapshot and sends writes here as events.
  const applyNoteEdit = useCallback((quote: string, find: (t: string) => number, replacement: string) => {
    pageRef.current?.edit((t) => {
      const i = find(t);
      return i < 0 ? null : replace(t, i, i + quote.length, replacement);
    });
  }, []);

  const onMcp = useCallback(
    (event: string, p: Record<string, unknown>) => {
      // Rust found the quote: `source` is the matched source text, `at` its offset a moment ago.
      const source = String(p.source);
      const near = (t: string) => place(t, { quote: source, at: Number(p.at) });
      if (event === "mcp-note") {
        const at = near(textRef.current);
        if (at < 0) return;
        const note: Note = {
          id: String(p.id),
          kind: p.kind === "correction" ? "correction" : "note",
          quote: source,
          label: String(p.quote),
          comment: String(p.comment),
          suggestion: typeof p.suggestion === "string" ? p.suggestion : null,
          at,
        };
        setNotes((list) => [...list, note]);
        setNotesOpen(true);
      } else if (event === "mcp-remove-note") {
        setNotes((list) => list.filter((n) => n.id !== p.id));
      } else if (event === "mcp-replace") {
        applyNoteEdit(source, near, String(p.replacement));
      }
    },
    [applyNoteEdit],
  );

  useEffect(() => {
    (window as unknown as { __picoMcp: typeof onMcp }).__picoMcp = onMcp;
    if (!isTauri()) return;
    let done = false;
    const stops: (() => void)[] = [];
    void import("@tauri-apps/api/event").then(({ listen }) => {
      for (const name of ["mcp-note", "mcp-remove-note", "mcp-replace"])
        void listen<Record<string, unknown>>(name, (e) => onMcp(name, e.payload)).then((stop) =>
          done ? stop() : stops.push(stop),
        );
    });
    return () => {
      done = true;
      stops.forEach((stop) => stop());
    };
  }, [onMcp]);

  useEffect(() => {
    try {
      if (isTauri() && localStorage.getItem(AI_KEY) === "1")
        void import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke<{ url: string; token: string }>("mcp_start").then(setAi, () => {}),
        );
    } catch {
      // No storage: the user connects from the menu.
    }
  }, []);

  // The cloud relay: the page holds the socket, Rust answers each message.
  useEffect(() => {
    if (!ai || !relay || !isTauri()) return;
    return connectRelay(
      relay.url,
      relay.key,
      async (msg) => (await import("@tauri-apps/api/core")).invoke("mcp_handle", { msg }),
      setRelayStatus,
    );
  }, [ai, relay, relayEpoch]);

  // Another computer took over; coming back to this window takes it back.
  useEffect(() => {
    if (relayStatus !== "replaced") return;
    flash("別のパソコンが AI 接続を使っています。このウィンドウに戻ると取り戻します。");
    const back = () => setRelayEpoch((n) => n + 1);
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, [relayStatus, flash]);

  // Push the document to Rust a moment after it, the selection or the notes change.
  useEffect(() => {
    if (!ai) return;
    let timer = 0;
    const push = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        void import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke("mcp_sync", {
            name: filenameRef.current,
            text: textRef.current,
            selection: pageRef.current?.selection()?.base ?? "",
            notes: notes.map(({ at: _, ...n }) => n),
          }),
        );
      }, 300);
    };
    push();
    document.addEventListener("selectionchange", push);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", push);
    };
  }, [ai, text, notes]);

  // Highlight noted quotes without touching the page DOM (CSS Custom Highlight API).
  useEffect(() => {
    const el = pageRef.current?.element;
    if (!el || typeof Highlight === "undefined") return;
    if (!notes.length) {
      CSS.highlights.delete("pico-note");
      return;
    }
    let frame = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const spans = notes
          .map((n) => [place(textRef.current, n), n.quote.length])
          .filter(([at]) => at >= 0)
          .map(([at, len]) => [at, at + len] as [number, number]);
        try {
          CSS.highlights.set("pico-note", new Highlight(...(pageRef.current?.ranges(spans) ?? [])));
        } catch {
          CSS.highlights.delete("pico-note");
        }
      });
    };
    paint();
    // Readings arrive later and repaint lines, so follow the DOM, not just the text.
    const mo = new MutationObserver(paint);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [notes]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (!isTauri()) return;
    e.preventDefault();
    void popupContextMenu((cmd) => runRef.current(cmd));
  }, []);

  const navigateMenu = useCallback((key: string) => {
    const id = openMenuRef.current;
    if (!id) return;
    const menu = menusRef.current.find((item) => item.id === id);
    if (!menu) return;
    const enabled = menu.items
      .map((item, index) => ({ item, index }))
      .filter(
        (row) => !row.item.separator && !row.item.disabled && row.item.command,
      );
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const all = menusRef.current;
      const idx = all.findIndex((item) => item.id === id);
      const delta = key === "ArrowRight" ? 1 : -1;
      const next = all[(idx + delta + all.length) % all.length];
      setOpenMenu(next.id);
      setMenuIndex(Math.max(0, firstEnabledIndex(next)));
      return;
    }
    if (!enabled.length) return;
    if (key === "Home") {
      setMenuIndex(enabled[0].index);
      return;
    }
    if (key === "End") {
      setMenuIndex(enabled[enabled.length - 1].index);
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      setMenuIndex((cur) => {
        const pos = enabled.findIndex((row) => row.index === cur);
        const delta = key === "ArrowDown" ? 1 : -1;
        const base = pos < 0 ? (delta > 0 ? -1 : 0) : pos;
        return enabled[(base + delta + enabled.length) % enabled.length].index;
      });
      return;
    }
    if (key === "Enter") {
      const item = menu.items[menuIndexRef.current];
      if (item?.command && !item.disabled) pickRef.current(item);
    }
  }, []);

  useEffect(() => {
    document.title = title;
    if (!isTauri()) return;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      void getCurrentWindow().setTitle(title);
    });
  }, [title]);

  useEffect(() => {
    const onBefore = (event: BeforeUnloadEvent) => {
      if (isDirty(textRef.current, savedRef.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let dead = false;
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen("pico-close-requested", () => {
        runRef.current("file.close");
      }).then((fn) => {
        if (dead) fn();
        else unlisten = fn;
      });
    });
    return () => {
      dead = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const stored = Number(localStorage.getItem(HIT_KEY) ?? "13841");
    let next = Number.isFinite(stored) ? stored : 13841;
    if (!sessionStorage.getItem(HIT_SESSION)) {
      next += 1;
      localStorage.setItem(HIT_KEY, String(next));
      sessionStorage.setItem(HIT_SESSION, "1");
    }
    setHits(String(next).padStart(8, "0"));
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuBarRef.current?.contains(event.target as Node))
        setOpenMenu(null);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [openMenu]);

  useEffect(() => {
    if (overlay === "saveas") saveAsInputRef.current?.focus();
    if (overlay === "cheatsheet")
      document.getElementById("cheatsheet-title")?.focus();
  }, [overlay]);

  useEffect(() => {
    const onCompositionStart = () => {
      composingRef.current = true;
      setImeOn(true);
    };
    const onCompositionEnd = () => {
      composingRef.current = false;
      suppressUntilRef.current = performance.now() + IME_SUPPRESS_MS;
      setImeOn(false);
    };
    const onKey = (event: KeyboardEvent) => {
      const now = performance.now();
      const target = document.activeElement;
      // ⌘A / Ctrl+A select the whole field in the Jisho, DeepL and dialog inputs too.
      if (
        (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "a"
      ) {
        event.preventDefault();
        target.select();
        return;
      }
      const ctx: KeyContext = {
        platform,
        target:
          pageRef.current?.element &&
          (target === pageRef.current.element ||
            pageRef.current.element.contains(target))
            ? "editor"
            : "other",
        overlay: overlayRef.current,
        composing: composingRef.current,
        suppressUntil: suppressUntilRef.current,
        now,
      };
      if (
        imeShouldIgnore(
          {
            isComposing: event.isComposing,
            key: event.key,
            keyCode: event.keyCode,
          },
          { composing: ctx.composing, suppressUntil: ctx.suppressUntil },
          now,
        )
      ) {
        // Keep the IME, but don't let the browser treat Ctrl/Cmd as "save page".
        const held: KeyContext = {
          ...ctx,
          composing: false,
          suppressUntil: 0,
          now,
        };
        const would = matchKey(
          {
            key: event.key,
            code: event.code,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            isComposing: false,
            keyCode: 0,
          },
          held,
        );
        if (would) event.preventDefault();
        return;
      }
      if (
        openMenuRef.current &&
        overlayRef.current === "none" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        [
          "ArrowDown",
          "ArrowUp",
          "ArrowLeft",
          "ArrowRight",
          "Enter",
          "Home",
          "End",
        ].includes(event.key)
      ) {
        event.preventDefault();
        navigateMenu(event.key);
        return;
      }
      const cmd = matchKey(event, ctx);
      if (
        !cmd &&
        event.key === "Escape" &&
        openMenuRef.current &&
        overlayRef.current === "none"
      ) {
        event.preventDefault();
        setOpenMenu(null);
        return;
      }
      if (!cmd) {
        if (
          (            ctx.overlay === "saveas" ||
            ctx.overlay === "confirm" ||
            ctx.overlay === "cheatsheet" ||
            ctx.overlay === "about" ||
            ctx.overlay === "ai") &&
          (event.ctrlKey || event.metaKey)
        ) {
          event.preventDefault();
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      runRef.current(cmd);
    };
    window.addEventListener("compositionstart", onCompositionStart, true);
    window.addEventListener("compositionend", onCompositionEnd, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("compositionstart", onCompositionStart, true);
      window.removeEventListener("compositionend", onCompositionEnd, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [navigateMenu, platform]);

  async function onPickedFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await openFile(file);
  }

  async function openFile(file: File) {
    try {
      loadDoc(
        decodeText(new Uint8Array(await file.arrayBuffer())),
        file.name,
        null,
        "開きました",
      );
    } catch {
      flash("UTF-8 でも Shift_JIS でもありません");
    }
  }

  const deferred = useDeferredValue(text);
  const counts = useMemo(
    () => `${countLines(deferred)}行 / ${countChars(deferred)}字`,
    [deferred],
  );
  const blockValue = kind === "row" ? "p" : kind;

  const hint = `♪ ふりがな：${furiLabel(furi)}　／　${modLabel(platform)}+/ でショートカット`;
  const rows = cheatsheetRows(platform);

  return (
    <div
      className="app"
      data-testid="app"
      data-furigana-mode={furi}
      data-dirty={dirty ? "yes" : "no"}
    >
      <nav className="menubar" ref={menuBarRef} aria-label="メニュー" data-tauri-drag-region>
        {menus.map((menu) => (
          <div
            key={menu.id}
            className={`menu${openMenu === menu.id ? " open" : ""}`}
            onMouseEnter={() => {
              if (openMenu) {
                setOpenMenu(menu.id);
                setMenuIndex(Math.max(0, firstEnabledIndex(menu)));
              }
            }}
          >
            <button
              type="button"
              className="menu-btn"
              data-testid={`menu-${menu.id}`}
              aria-expanded={openMenu === menu.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(menuCommand(menu.id))}
            >
              {menu.label}
            </button>
            {openMenu === menu.id && (
              <div className="dropdown" role="menu">
                {menu.items.map((item, index) =>
                  item.separator ? (
                    <div
                      key={`sep-${index}`}
                      className="sep-line"
                      role="separator"
                    />
                  ) : (
                    <button
                      key={item.path ?? item.label}
                      type="button"
                      role="menuitem"
                      className={`mi${menuIndex === index ? " active" : ""}`}
                      disabled={item.disabled}
                      title={item.path}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setMenuIndex(index)}
                      onClick={() => pick(item)}
                    >
                      <span>{item.label}</span>
                      <span className="shortcut">
                        {item.command && !item.path ? shortcutFor(item.command, platform) : ""}
                      </span>
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="tb" role="toolbar" aria-label="ツールバー" data-tauri-drag-region>
        <button
          type="button"
          className="tbtn lime"
          data-testid="btn-new"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run("file.new")}
        >
          新規
        </button>
        <button
          type="button"
          className="tbtn"
          data-testid="btn-open"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run("file.open")}
        >
          開く
        </button>
        <button
          type="button"
          className="tbtn"
          data-testid="btn-save"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run("file.save")}
        >
          保存
        </button>
        <div className="sep" />
        <select
          className="style-pick"
          data-testid="style-pick"
          aria-label="段落スタイル"
          value={blockValue}
          onChange={(e) => block(e.target.value as Block)}
        >
          <option value="p">本文</option>
          <option value="h1">大見出し</option>
          <option value="h2">中見出し</option>
          <option value="h3">小見出し</option>
          <option value="li">箇条書き</option>
        </select>
        <button
          type="button"
          className="tbtn b"
          data-testid="btn-bold"
          title={shortcutFor("format.bold", platform)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run("format.bold")}
        >
          太
        </button>
        <button
          type="button"
          className="tbtn i"
          data-testid="btn-italic"
          title={shortcutFor("format.italic", platform)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run("format.italic")}
        >
          斜
        </button>
        <button
          type="button"
          className={`tbtn${kind === "li" ? " on" : ""}`}
          data-testid="btn-bullet"
          title={shortcutFor("format.bullet", platform)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run("format.bullet")}
        >
          ・箇条
        </button>
        <button
          type="button"
          className="tbtn"
          data-testid="btn-table"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run("insert.table")}
        >
          表
        </button>
        <div className="sep" />
        <button
          type="button"
          className={`tbtn cyan${furi !== "hide" ? " on" : ""}`}
          data-testid="btn-furi"
          title={`${shortcutFor("view.furigana", platform)} で切替`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run("view.furigana")}
        >
          ふりがな {furiLabel(furi)}
        </button>
        <button
          type="button"
          className={`tbtn${dictOpen ? " on" : ""}`}
          data-testid="btn-dict"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run("dict.toggle")}
        >
          辞書
        </button>
        <button
          type="button"
          className={`tbtn${pdf ? " on" : ""}`}
          data-testid="btn-pdfview"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run("view.pdf")}
        >
          宿題PDF
        </button>
        <button
          type="button"
          className={`tbtn${trOpen ? " on" : ""}`}
          data-testid="btn-translate"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run("translate.toggle")}
        >
          翻訳
        </button>
        <button
          type="button"
          className={`tbtn${notesOpen ? " on" : ""}`}
          data-testid="btn-notes"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run("notes.toggle")}
        >
          メモ{notes.length > 0 ? `（${notes.length}）` : ""}
        </button>
        <div className="sep" />
        <button
          type="button"
          className="tbtn"
          data-testid="btn-pdf"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run("file.pdf")}
        >
          PDF出力
        </button>
      </div>

      <div className="main">
        {pdf && (
          <>
            <aside className="pdfpane" data-testid="pdfpane" aria-label="PDF" style={{ flexBasis: pdfWidth }}>
              <div className="dict-cap">
                <span className="pdf-name">{pdf.name}</span>
                <button type="button" className="pdf-close" aria-label="PDFを閉じる" onClick={() => run("view.pdf")}>
                  ×
                </button>
              </div>
              <iframe src={pdf.url} title={pdf.name} />
            </aside>
            <div
              className="splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label="PDFの幅"
              aria-valuenow={pdfWidth}
              tabIndex={0}
              data-testid="pdf-splitter"
              onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
              onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && resizePdf(e.clientX)}
              onPointerUp={savePdfWidth}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  resizePdf(pdfWidth + (e.key === "ArrowRight" ? 40 : -40));
                }
              }}
              onKeyUp={savePdfWidth}
            />
          </>
        )}
        <div className="desk">
          <Page ref={pageRef} doc={doc} empty={text.length === 0}
            furi={furi}
            onContextMenu={onContextMenu}
            fontSize={fontSize}
            onChange={setText}
            onKind={setKind}
          />
        </div>
        {(dictOpen || trOpen || notesOpen) && (
          <div className="side">
            {dictOpen && <Dict seed={dictSeed} />}
            {trOpen && <Translate seed={trSeed} />}
            {notesOpen && (
              <Notes
                notes={notes}
                text={text}
                onPick={(n) => {
                  const at = place(textRef.current, n);
                  if (at >= 0) pageRef.current?.select(at, at + n.quote.length);
                }}
                onApply={(n) => {
                  applyNoteEdit(n.quote, (t) => place(t, n), n.suggestion ?? n.quote);
                  setNotes((list) => list.filter((x) => x.id !== n.id));
                }}
                onRemove={(id) => setNotes((list) => list.filter((x) => x.id !== id))}
              />
            )}
          </div>
        )}
      </div>

      <footer className="status">
        <div className="sp flex" data-testid="status-message">
          {status || hint}
        </div>
        <div className="sp counter" data-testid="hit-counter">
          訪問者 {hits}
        </div>
        <div className="sp" data-testid="status-furi">
          ふりがな：{furiLabel(furi)}
        </div>
        <div className="sp" data-testid="status-count">
          {counts}
        </div>
        <div
          className="sp ime"
          data-testid="ime"
          title={imeOn ? "変換中" : "直接入力"}
        >
          {imeOn ? "あ" : "A"}
        </div>
      </footer>

      <input
        ref={fileRef}
        className="file-input"
        data-testid="file-input"
        type="file"
        accept=".txt,.md,text/plain,text/markdown"
        onChange={(event) => void onPickedFile(event)}
      />
      <input
        ref={pdfRef}
        className="file-input"
        data-testid="pdf-input"
        type="file"
        accept=".pdf,application/pdf"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void file.arrayBuffer().then((b) => showPdf(b, file.name));
        }}
      />

      {overlay !== "none" && (
        <div
          className="overlay"
          onMouseDown={() => overlay === "cheatsheet" && setOverlay("none")}
        >
          {overlay === "cheatsheet" && (
            <div
              className="dialog cheat"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cheatsheet-title"
              data-testid="cheatsheet"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="dialog-title" id="cheatsheet-title" tabIndex={-1}>
                ★ ショートカット一覧 ★
              </div>
              <div className="dialog-body cheat-grid">
                <p className="cheat-note">
                  {platform === "mac"
                    ? "⌘ は Command です。"
                    : "Ctrl は Linux / Windows の Control です。"}
                  日本語入力の変換中（IME）はショートカットを無視します。Esc
                  で閉じます。
                </p>
                {groupRows(rows).map((group) => (
                  <section key={group.name}>
                    <h2>{group.name}</h2>
                    <table>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr key={row.label}>
                            <td>{row.label}</td>
                            <td>
                              <kbd>{row.keys}</kbd>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                ))}
                <p className="cheat-note">
                  ふりがなは自動で付きます（ファイルには書きません）。
                  見出し <code># </code>　箇条書き <code>- </code>　太字{" "}
                  <code>**…**</code>　斜体 <code>*…*</code>　表{" "}
                  <code>| a | b |</code>
                  　バックスラッシュでエスケープ。
                </p>
              </div>
            </div>
          )}

          {overlay === "saveas" && (
            <form
              className="dialog prompt"
              role="dialog"
              aria-modal="true"
              aria-labelledby="saveas-title"
              data-testid="saveas-dialog"
              onMouseDown={(event) => event.stopPropagation()}
              onSubmit={(event) => {
                event.preventDefault();
                commitSaveAs();
              }}
            >
              <div className="dialog-title" id="saveas-title">
                名前を付けて保存
              </div>
              <div className="dialog-body">
                <label className="field">
                  ファイル名
                  <input
                    ref={saveAsInputRef}
                    data-testid="saveas-input"
                    defaultValue={saveAsDraft}
                  />
                </label>
                <p className="cheat-note">
                  拡張子が無いときは .txt を付けます。.md も保存できます。
                </p>
                <div className="dialog-actions">
                  <button type="submit" className="tbtn lime">
                    保存
                  </button>
                  <button
                    type="button"
                    className="tbtn"
                    onClick={() => run("dialog.cancel")}
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            </form>
          )}

          {overlay === "confirm" && (
            <div
              className="dialog prompt"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              data-testid="confirm-dialog"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="dialog-title" id="confirm-title">
                保存の確認
              </div>
              <div className="dialog-body">
                <p>「{filename}」への変更は保存されていません。</p>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="tbtn lime"
                    data-testid="confirm-save"
                    onClick={() => run("dialog.confirm")}
                  >
                    保存する
                  </button>
                  <button
                    type="button"
                    className="tbtn"
                    data-testid="confirm-discard"
                    onClick={() => {
                      const action = pendingRef.current;
                      pendingRef.current = null;
                      setOverlay("none");
                      action?.();
                    }}
                  >
                    保存しない
                  </button>
                  <button
                    type="button"
                    className="tbtn"
                    data-testid="confirm-cancel"
                    onClick={() => run("dialog.cancel")}
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            </div>
          )}

          {overlay === "ai" && ai && (
            <div
              className="dialog prompt"
              role="dialog"
              aria-modal="true"
              aria-labelledby="ai-title"
              data-testid="ai-dialog"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="dialog-title" id="ai-title">
                AIと接続（MCP）
              </div>
              <div className="dialog-body">
                <p>MCP に対応した AI（Codex、ChatGPT、ローカル LLM など）に次を設定してください。AI は作文を読んで、メモや訂正を付けられます。</p>
                <label className="field">
                  URL（Streamable HTTP）
                  <input readOnly value={ai.url} onFocus={(e) => e.target.select()} />
                </label>
                <label className="field">
                  Bearer トークン
                  <input readOnly value={ai.token} onFocus={(e) => e.target.select()} />
                </label>
                <h2>クラウドの AI（Grok など）</h2>
                <form
                  ref={relayFormRef}
                  data-testid="relay-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    const url = String(f.get("url") ?? "").trim();
                    const key = String(f.get("key") ?? "").trim();
                    const next = url && key ? { url, key } : null;
                    try {
                      if (next) localStorage.setItem(RELAY_KEY, JSON.stringify(next));
                      else localStorage.removeItem(RELAY_KEY);
                    } catch {
                      // Without storage the relay works until the app closes.
                    }
                    setRelay(next);
                    if (!next) setRelayStatus(null);
                  }}
                >
                  <label className="field">
                    リレーの URL
                    <input name="url" placeholder="https://pico-relay.＜あなた＞.workers.dev" defaultValue={relay?.url ?? ""} />
                  </label>
                  <label className="field">
                    APP_KEY
                    <input name="key" type="password" defaultValue={relay?.key ?? ""} />
                  </label>
                  <div className="dialog-actions">
                    <span className="cheat-note" data-testid="relay-status">
                      {relay ? `状態：${relayStatus ? RELAY_LABEL[relayStatus] : "—"}` : "未設定"}
                    </span>
                    <button type="submit" className="tbtn lime">
                      保存して接続
                    </button>
                  </div>
                </form>
                <p className="cheat-note">
                  Grok には <code>{relay ? `${relay.url.replace(/\/+$/, "")}/mcp` : "＜リレーの URL＞/mcp"}</code> と BOT_KEY を設定します。どのパソコンで開いても同じ URL で、最後に開いたパソコンにつながります。キーを知っている人は作文を読めて書けます。
                </p>
                <div className="dialog-actions">
                  <button type="button" className="tbtn cyan" onClick={() => run("dialog.cancel")}>
                    閉じる
                  </button>
                </div>
              </div>
            </div>
          )}

          {overlay === "about" && (
            <div
              className="dialog prompt"
              role="dialog"
              aria-modal="true"
              aria-labelledby="about-title"
              data-testid="about-dialog"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="dialog-title" id="about-title">
                ぴこぴこ作文帳 Ver.0.1
              </div>
              <div className="dialog-body">
                <p>日本語を勉強する人のための小さなワープロです。</p>
                <p>ふりがなは自動で付きます。表示・非表示・ホバーを選べます。</p>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="tbtn cyan"
                    onClick={() => run("dialog.cancel")}
                  >
                    閉じる
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      <span className="sr-only" data-testid="keymap-count">
        {KEYMAP.length}
      </span>
    </div>
  );
}

function groupRows(rows: { group: string; label: string; keys: string }[]) {
  const groups: { name: string; rows: { label: string; keys: string }[] }[] =
    [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (!last || last.name !== row.group)
      groups.push({ name: row.group, rows: [] });
    groups[groups.length - 1].rows.push({ label: row.label, keys: row.keys });
  }
  return groups;
}
