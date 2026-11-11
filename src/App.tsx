import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  countLines,
  cycleFuri,
  formatTitle,
  furiLabel,
  isDirty,
  nextFontSize,
  type FuriMode,
} from "./lib/document";
import { basename, downloadText, isTauri, readPickedFile, sanitizeFilename } from "./lib/files";
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
import { MENUS, firstEnabledIndex, menuCommand, type MenuId } from "./lib/menus";
import { applyReading, visibleCharCount } from "./lib/pageEdit";
import { nextRuby, prevRuby, rubySpans } from "./lib/rubyEdit";
import { SAMPLE, SAMPLE_NAME, UNTITLED_NAME } from "./lib/sample";
import { Page, type PageHandle } from "./ui/Page";

const HIT_KEY = "pico-sakubun-hits";
const HIT_SESSION = "pico-sakubun-hit-session";

export function App() {
  const platform: Platform =
    typeof navigator === "undefined"
      ? "other"
      : detectPlatform(navigator.platform, navigator.userAgent);

  const [text, setText] = useState(SAMPLE);
  const [saved, setSaved] = useState(SAMPLE);
  const [filename, setFilename] = useState(SAMPLE_NAME);
  const [path, setPath] = useState<string | null>(null);
  const [furi, setFuri] = useState<FuriMode>("show");
  const [fontSize, setFontSize] = useState(18);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [rubyBase, setRubyBase] = useState("");
  const [saveAsDraft, setSaveAsDraft] = useState("");
  const [imeOn, setImeOn] = useState(false);
  const [hits, setHits] = useState("00013842");

  const textRef = useRef(text);
  const savedRef = useRef(saved);
  const filenameRef = useRef(filename);
  const pathRef = useRef(path);
  const overlayRef = useRef(overlay);
  const openMenuRef = useRef(openMenu);
  const menuIndexRef = useRef(menuIndex);
  const composingRef = useRef(false);
  const suppressUntilRef = useRef(0);
  const pendingRef = useRef<(() => void) | null>(null);
  const rubySelRef = useRef<{ start: number; end: number; base: string } | null>(null);
  const pageRef = useRef<PageHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rubyInputRef = useRef<HTMLInputElement>(null);
  const saveAsInputRef = useRef<HTMLInputElement>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<(cmd: CommandId) => void>(() => {});
  const statusTimer = useRef(0);

  textRef.current = text;
  savedRef.current = saved;
  filenameRef.current = filename;
  pathRef.current = path;
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
    (next: string, name: string, nextPath: string | null, message: string) => {
      setText(next);
      setSaved(next);
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
      downloadText(name, textRef.current);
      setFilename(name);
      setSaved(textRef.current);
      flash("保存しました");
    },
    [flash],
  );

  const tauriWrite = useCallback(
    async (target: string) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_document", { path: target, contents: textRef.current });
      setPath(target);
      setFilename(basename(target));
      setSaved(textRef.current);
      flash("保存しました");
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
    } catch {
      flash("保存できませんでした");
      return false;
    }
  }, [flash, tauriWrite]);

  const save = useCallback(async (): Promise<boolean> => {
    if (isTauri()) {
      if (!pathRef.current) return tauriSaveAs();
      try {
        await tauriWrite(pathRef.current);
        return true;
      } catch {
        flash("保存できませんでした");
        return false;
      }
    }
    saveBrowser(filenameRef.current);
    return true;
  }, [flash, saveBrowser, tauriSaveAs, tauriWrite]);

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

  const doOpen = useCallback(async () => {
    if (isTauri()) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const picked = await open({
        multiple: false,
        filters: [{ name: "作文", extensions: ["txt", "md"] }],
      });
      if (typeof picked !== "string") return;
      try {
        const body = await invoke<string>("read_document", { path: picked });
        loadDoc(body, basename(picked), picked, "開きました");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        flash(msg.includes("UTF-8") ? "このファイルは UTF-8 ではありません" : "ファイルを開けませんでした");
      }
      return;
    }
    fileRef.current?.click();
  }, [flash, loadDoc]);

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

  const startRuby = useCallback(() => {
    const sel = pageRef.current?.selection();
    if (!sel || sel.start === sel.end || !sel.base) {
      flash("文字列を選択してください");
      return;
    }
    if (sel.base.includes("\n") || sel.base.includes("\r")) {
      flash("ルビは1行にしてください");
      return;
    }
    rubySelRef.current = sel;
    setRubyBase(sel.base);
    setOpenMenu(null);
    setOverlay("ruby");
  }, [flash]);

  const commitRuby = useCallback(() => {
    const sel = rubySelRef.current;
    if (!sel) return;
    const reading = rubyInputRef.current?.value ?? "";
    const result = applyReading(textRef.current, sel.start, sel.end, sel.base, reading);
    if (!result.ok) {
      flash(result.reason === "empty-reading" ? "読みを入力してください" : "ルビを挿入できません");
      return;
    }
    pageRef.current?.queueSelection(result.cursor, result.cursor);
    setText(result.text);
    setOverlay("none");
    rubySelRef.current = null;
    flash("ルビを挿入しました");
  }, [flash]);

  const jumpRuby = useCallback(
    (dir: 1 | -1) => {
      const sel = pageRef.current?.selection();
      const pos = sel?.start ?? 0;
      const span = dir > 0 ? nextRuby(textRef.current, pos) : prevRuby(textRef.current, pos);
      if (!span) {
        flash(dir > 0 ? "次のルビはありません" : "前のルビはありません");
        return;
      }
      const index = rubySpans(textRef.current).findIndex((item) => item.start === span.start && item.end === span.end);
      pageRef.current?.selectRuby(index);
      flash("ルビを選択しました");
    },
    [flash],
  );

  const run = useCallback(
    (cmd: CommandId) => {
      if (cmd.startsWith("menu.")) {
        const id = cmd.slice("menu.".length) as MenuId;
        setOpenMenu((cur) => {
          const next = cur === id ? null : id;
          if (next) {
            const menu = MENUS.find((item) => item.id === next);
            if (menu) setMenuIndex(Math.max(0, firstEnabledIndex(menu)));
          }
          return next;
        });
        return;
      }
      setOpenMenu(null);
      switch (cmd) {
        case "file.new":
          guard(() => loadDoc("", UNTITLED_NAME, null, "新しい作文を開きました"));
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
          guard(() => loadDoc(SAMPLE, SAMPLE_NAME, null, "サンプルを開きました"));
          break;
        case "file.close":
          guard(() => {
            void destroyWindow();
          });
          break;
        case "edit.ruby":
          startRuby();
          break;
        case "edit.rubyNext":
          jumpRuby(1);
          break;
        case "edit.rubyPrev":
          jumpRuby(-1);
          break;
        case "edit.selectAll":
          pageRef.current?.selectAll();
          break;
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
          setOverlay((current) => (current === "cheatsheet" ? "none" : "cheatsheet"));
          break;
        case "help.about":
          setOverlay("about");
          break;
        case "dialog.cancel":
          pendingRef.current = null;
          rubySelRef.current = null;
          setOverlay("none");
          break;
        case "dialog.confirm":
          if (overlayRef.current === "ruby") commitRuby();
          else if (overlayRef.current === "saveas") commitSaveAs();
          else if (overlayRef.current === "confirm") {
            void (async () => {
              const ok = await save();
              if (!ok) return;
              const action = pendingRef.current;
              pendingRef.current = null;
              setOverlay("none");
              action?.();
            })();
          } else if (overlayRef.current === "about" || overlayRef.current === "cheatsheet") {
            setOverlay("none");
          }
          break;
        default:
          break;
      }
    },
    [beginSaveAs, commitRuby, commitSaveAs, destroyWindow, doOpen, guard, jumpRuby, loadDoc, save, startRuby],
  );
  runRef.current = run;

  const navigateMenu = useCallback((key: string) => {
    const id = openMenuRef.current;
    if (!id) return;
    const menu = MENUS.find((item) => item.id === id);
    if (!menu) return;
    const enabled = menu.items
      .map((item, index) => ({ item, index }))
      .filter((row) => !row.item.separator && !row.item.disabled && row.item.command);
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const idx = MENUS.findIndex((item) => item.id === id);
      const delta = key === "ArrowRight" ? 1 : -1;
      const next = MENUS[(idx + delta + MENUS.length) % MENUS.length];
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
      if (item?.command && !item.disabled) runRef.current(item.command);
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
      if (!menuBarRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [openMenu]);

  useEffect(() => {
    if (overlay === "ruby") rubyInputRef.current?.focus();
    if (overlay === "saveas") saveAsInputRef.current?.focus();
    if (overlay === "cheatsheet") document.getElementById("cheatsheet-title")?.focus();
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
      const ctx: KeyContext = {
        platform,
        target: pageRef.current?.element && (target === pageRef.current.element || pageRef.current.element.contains(target)) ? "editor" : "other",
        overlay: overlayRef.current,
        composing: composingRef.current,
        suppressUntil: suppressUntilRef.current,
        now,
      };
      if (
        imeShouldIgnore(
          { isComposing: event.isComposing, key: event.key, keyCode: event.keyCode },
          { composing: ctx.composing, suppressUntil: ctx.suppressUntil },
          now,
        )
      ) {
        // Keep the IME, but don't let the browser treat Ctrl/Cmd as "save page".
        const held: KeyContext = { ...ctx, composing: false, suppressUntil: 0, now };
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
        ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", "Home", "End"].includes(event.key)
      ) {
        event.preventDefault();
        navigateMenu(event.key);
        return;
      }
      const cmd = matchKey(event, ctx);
      if (!cmd && event.key === "Escape" && openMenuRef.current && overlayRef.current === "none") {
        event.preventDefault();
        setOpenMenu(null);
        return;
      }
      if (!cmd) {
        if (
          (ctx.overlay === "ruby" ||
            ctx.overlay === "saveas" ||
            ctx.overlay === "confirm" ||
            ctx.overlay === "cheatsheet" ||
            ctx.overlay === "about") &&
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
    if (!file) return;
    try {
      const body = await readPickedFile(file);
      loadDoc(body, file.name, null, "開きました");
    } catch {
      flash("このファイルは UTF-8 ではありません");
    }
  }

  async function windowButton(action: "min" | "max" | "close") {
    if (action === "close") {
      run("file.close");
      return;
    }
    if (!isTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (action === "min") await win.minimize();
    if (action === "max") await win.toggleMaximize();
  }

  const hint = `♪ ふりがな：${furiLabel(furi)}　／　${modLabel(platform)}+/ でショートカット`;
  const rows = cheatsheetRows(platform);

  return (
    <div
      className="desktop"
      data-testid="app"
      data-furigana-mode={furi}
      data-dirty={dirty ? "yes" : "no"}
    >
      <div className="win">
        <header className="titlebar" data-tauri-drag-region>
          <svg className="app-ico" viewBox="0 0 16 16" aria-hidden="true">
            <rect width="16" height="16" fill="#FF00AA" />
            <rect x="2" y="2" width="12" height="12" fill="#00FFFF" />
            <rect x="4" y="4" width="8" height="8" fill="#FFFF00" />
            <rect x="6" y="6" width="4" height="4" fill="#FF0033" />
          </svg>
          <div className={`ttl${dirty ? " dirty" : ""}`} data-testid="title" data-tauri-drag-region>
            {dirty ? "● " : "★ "}
            {title}
          </div>
          <div className="caps">
            <button type="button" className="cap" aria-label="最小化" onClick={() => void windowButton("min")}>
              _
            </button>
            <button type="button" className="cap" aria-label="最大化" onClick={() => void windowButton("max")}>
              □
            </button>
            <button type="button" className="cap close" aria-label="閉じる" onClick={() => void windowButton("close")}>
              ×
            </button>
          </div>
        </header>

        <div className="banner">
          <h1>ようこそ！ ぴこぴこ作文帳</h1>
          <span className="badge new">NEW!</span>
          <span className="badge imode">i-mode</span>
          <span className="badge jsky">J-SKY</span>
          <span className="badge ez">EZWeb</span>
          <div className="stars" aria-hidden="true">
            ★☆★☆★☆★
          </div>
        </div>

        <nav className="menubar" ref={menuBarRef} aria-label="メニュー">
          {MENUS.map((menu) => (
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
                      <div key={`sep-${index}`} className="sep-line" role="separator" />
                    ) : (
                      <button
                        key={item.label}
                        type="button"
                        role="menuitem"
                        className={`mi${menuIndex === index ? " active" : ""}`}
                        disabled={item.disabled}
                        title={item.todo}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setMenuIndex(index)}
                        onClick={() => item.command && run(item.command)}
                      >
                        <span>{item.label}</span>
                        <span className="shortcut">
                          {item.disabled ? "準備中" : item.command ? shortcutFor(item.command, platform) : ""}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="tb" role="toolbar" aria-label="ツールバー">
          <button type="button" className="tbtn lime" data-testid="btn-new" onMouseDown={(e) => e.preventDefault()} onClick={() => run("file.new")}>
            新規
          </button>
          <button type="button" className="tbtn" data-testid="btn-open" onMouseDown={(e) => e.preventDefault()} onClick={() => run("file.open")}>
            開く
          </button>
          <button type="button" className="tbtn" data-testid="btn-save" onMouseDown={(e) => e.preventDefault()} onClick={() => run("file.save")}>
            保存
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
          <div className="sep" />
          <button type="button" className="tbtn pink" data-testid="btn-ruby" title={shortcutFor("edit.ruby", platform)} onMouseDown={(e) => e.preventDefault()} onClick={() => run("edit.ruby")}>
            ルビ
          </button>
          <button type="button" className="tbtn" data-testid="btn-dict" disabled title="準備中：辞書パネル（Jisho API）">
            辞書
          </button>
          <button type="button" className="tbtn hot" data-testid="btn-pdf" disabled title="準備中：PDF出力">
            ▼ PDF出力
          </button>
        </div>

        <div className="main">
          <section className="docframe">
            <div className="doc-cap">◆ にっきちょう ／ {filename}{dirty ? " *" : ""} ◆</div>
            <div className="docwrap">
              <Page ref={pageRef} text={text} furi={furi} fontSize={fontSize} onChange={setText} />
            </div>
          </section>

          <aside className="dict todo" aria-label="辞書（準備中）">
            <div className="dict-cap">◆ ことばサーチ − Jisho.org</div>
            <div className="dict-body">
              <div className="search-row">
                <div className="fake-input">公園</div>
                <button type="button" className="go" disabled>
                  検索
                </button>
              </div>
              <div className="headword">
                <div className="w">公園</div>
                <div className="r">こうえん</div>
              </div>
              <div className="tags">
                <span className="tagp n4">JLPT N5</span>
                <span className="tagp">名詞</span>
                <span className="tagp">WK 7</span>
              </div>
              <div className="meanings">
                <ol>
                  <li>park; public garden</li>
                </ol>
              </div>
              <div className="ex">
                <span className="lbl">★ 例文</span>
                午後、公園を散歩しました。
              </div>
              <button type="button" className="insert-btn" disabled>
                ★ ふりがなを挿入 ★
              </button>
              <div className="src">TODO：Jisho API　／　準備中</div>
            </div>
            <div className="veil">
              <strong>準備中</strong>
              <span>辞書パネルは次の版で入ります</span>
            </div>
          </aside>
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
          <div className="sp">
            {countLines(text)}行 / {visibleCharCount(text)}字
          </div>
          <div className="sp ime" data-testid="ime" title={imeOn ? "変換中" : "直接入力"}>
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

        {overlay !== "none" && (
          <div className="overlay" onMouseDown={() => overlay === "cheatsheet" && setOverlay("none")}>
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
                    {platform === "mac" ? "⌘ は Command です。" : "Ctrl は Linux / Windows の Control です。"}
                    日本語入力の変換中（IME）はショートカットを無視します。Esc で閉じます。
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
                    ルビの書き方：<code>漢字《かんじ》</code>　<code>｜食べ《た》</code>　<code>{"{漢字|かんじ}"}</code>
                    　バックスラッシュでエスケープ。
                  </p>
                </div>
              </div>
            )}

            {overlay === "ruby" && (
              <form
                className="dialog prompt"
                role="dialog"
                aria-modal="true"
                aria-labelledby="ruby-title"
                data-testid="ruby-prompt"
                onMouseDown={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                  event.preventDefault();
                  commitRuby();
                }}
              >
                <div className="dialog-title" id="ruby-title">
                  ルビを挿入
                </div>
                <div className="dialog-body">
                  <p>
                    対象：<strong data-testid="ruby-base">{rubyBase}</strong>
                  </p>
                  <label className="field">
                    読み
                    <input
                      ref={rubyInputRef}
                      data-testid="ruby-input"
                      lang="ja"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="かんじ"
                    />
                  </label>
                  <p className="cheat-note">Enter で挿入　／　Esc でキャンセル。変換中の Enter は確定に使いません。</p>
                  <div className="dialog-actions">
                    <button type="submit" className="tbtn pink">
                      挿入
                    </button>
                    <button type="button" className="tbtn" onClick={() => run("dialog.cancel")}>
                      キャンセル
                    </button>
                  </div>
                </div>
              </form>
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
                    <input ref={saveAsInputRef} data-testid="saveas-input" defaultValue={saveAsDraft} />
                  </label>
                  <p className="cheat-note">拡張子が無いときは .txt を付けます。.md も保存できます。</p>
                  <div className="dialog-actions">
                    <button type="submit" className="tbtn lime">
                      保存
                    </button>
                    <button type="button" className="tbtn" onClick={() => run("dialog.cancel")}>
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
                  <p>
                    「{filename}」への変更は保存されていません。
                  </p>
                  <div className="dialog-actions">
                    <button type="button" className="tbtn lime" data-testid="confirm-save" onClick={() => run("dialog.confirm")}>
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
                    <button type="button" className="tbtn" data-testid="confirm-cancel" onClick={() => run("dialog.cancel")}>
                      キャンセル
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
                  <p>ふりがな付きで日本語の作文を書くためのエディタです。</p>
                  <p>
                    記法：<code>漢字《かんじ》</code>　<code>｜食べ《た》</code>　<code>{"{漢字|かんじ}"}</code>
                  </p>
                  <p className="cheat-note">辞書・PDF出力・自動ふりがなは次の版です。</p>
                  <div className="dialog-actions">
                    <button type="button" className="tbtn cyan" onClick={() => run("dialog.cancel")}>
                      閉じる
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <span className="sr-only" data-testid="keymap-count">
        {KEYMAP.length}
      </span>
    </div>
  );
}

function groupRows(rows: { group: string; label: string; keys: string }[]) {
  const groups: { name: string; rows: { label: string; keys: string }[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (!last || last.name !== row.group) groups.push({ name: row.group, rows: [] });
    groups[groups.length - 1].rows.push({ label: row.label, keys: row.keys });
  }
  return groups;
}
