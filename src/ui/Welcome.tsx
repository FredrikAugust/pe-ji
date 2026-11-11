import { useEffect, useRef } from "react";
import { basename } from "../lib/files";

/** Shorten /Users/name/… and /home/name/… to ~/… for display. */
const folderOf = (path: string) => path.slice(0, path.length - basename(path).length).replace(/^\/(Users|home)\/[^/]+\//, "~/");

/** The start screen: new, open, recent files. ↑↓ / Home / End move, Enter opens, 1–9 open a recent file. */
export function Welcome(props: {
  recent: string[];
  newKey: string;
  openKey: string;
  onNew: () => void;
  onOpen: () => void;
  onSample: () => void;
  onRecent: (path: string) => void;
  draft: string;
  onDraft: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLButtonElement>(props.recent.length ? ".recent button" : "button")?.focus();
    // Focus once, when the screen appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const items = [...listRef.current!.querySelectorAll<HTMLButtonElement>("button")];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (k: number) => {
      e.preventDefault();
      items[(k + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i < 0 ? items.length - 1 : i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (/^[1-9]$/.test(e.key) && props.recent[Number(e.key) - 1]) {
      e.preventDefault();
      props.onRecent(props.recent[Number(e.key) - 1]);
    }
  };

  return (
    <div className="welcome" data-testid="welcome">
      <div className="dialog welcome-box" ref={listRef} onKeyDown={onKeyDown}>
        <div className="dialog-title">ようこそ — pe-ji（ページ）</div>
        <div className="dialog-body">
          <h2>はじめる</h2>
          <button type="button" className="mi" onClick={props.onNew}>
            <span>新しいページ</span>
            <span className="shortcut">{props.newKey}</span>
          </button>
          <button type="button" className="mi" onClick={props.onOpen}>
            <span>開く…</span>
            <span className="shortcut">{props.openKey}</span>
          </button>
          <button type="button" className="mi" onClick={props.onSample}>
            <span>サンプルを開く</span>
            <span className="shortcut" />
          </button>
          {props.draft && (
            <button type="button" className="mi" data-testid="open-draft" onClick={props.onDraft}>
              <span className="recent-name">
                保存していない下書き
                <span className="recent-dir">{props.draft.slice(0, 30)}</span>
              </span>
              <span className="shortcut" />
            </button>
          )}
          {props.recent.length > 0 && (
            <>
              <h2>最近使ったファイル</h2>
              <div className="recent">
                {props.recent.map((path, n) => (
                  <button type="button" className="mi" key={path} title={path} onClick={() => props.onRecent(path)}>
                    <span className="recent-name">
                      {basename(path)}
                      <span className="recent-dir">{folderOf(path)}</span>
                    </span>
                    <span className="shortcut">{n < 9 ? n + 1 : ""}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="cheat-note">↑↓ で選んで Enter。{props.recent.length > 0 && "1〜9 で最近のファイルを開きます。"}ファイルをウィンドウにドロップしても開けます。</p>
        </div>
      </div>
    </div>
  );
}
