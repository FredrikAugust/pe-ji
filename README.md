# ぴこぴこ作文帳

A small desktop editor for Japanese homework. You write on one page. Furigana sits above the kanji as you edit. The file on disk is still plain text with furigana markup.

Repository: [FredrikAugust/pe-ji](https://github.com/FredrikAugust/pe-ji). Development is on `main`.

This is **v0**: that page, the three furigana modes, and file open/save. The dictionary panel and PDF export are visible but disabled.

The window is a late-90s Japanese web page on purpose (Geocities / i-mode). Chrome uses the bundled [DotGothic16](https://fonts.google.com/specimen/DotGothic16) pixel font. The document itself uses bundled [Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP) so the writing stays easy to read. Nothing is loaded from a CDN at runtime.

## Markup

| Write this | Reading on |
| --- | --- |
| `漢字《かんじ》` | the kanji run directly before `《` |
| `｜食べ《た》` or `\|食べ《た》` | an explicit base (full-width or half-width pipe) |
| `{漢字\|かんじ}` | anything, brace form |

Rules the parser actually implements:

- The pipe is optional only when the base is a run of kanji (CJK ideographs, `々`, `〆`, `ヵ`, `ヶ`, and the CJK extension blocks). Okurigana blocks the implicit form: `晴れ《はれ》` is literal; write `晴《はれ》れ` or `｜晴れ《はれ》`.
- Ruby does not cross a newline. Unmatched `《》`, `{}`, or a pipe with no reading stays as literal text.
- An empty base is not ruby. An empty reading (`漢字《》`, `{漢字|}`) is ruby with an empty `<rt>`.
- A backslash escapes the next character: `\《`, `\{`, `\\`, `\|`.
- The page paints text nodes, not `innerHTML`, so `<` in the document cannot become markup. Paste is plain text.

The Rust parser in `crates/pico-core` and the TypeScript parser in `src/lib/parser.ts` are locked to the same cases in `testdata/ruby_cases.json`.

## Keybindings

Mod is **⌘ on macOS** and **Ctrl on Linux and Windows**. Shortcuts are ignored while an IME composition is active (`compositionstart` / `isComposing` / keyCode 229), and for a short moment after composition ends, so confirming a candidate does not fire the shortcut.

| Action | Linux / Windows | macOS |
| --- | --- | --- |
| 新規 New | Ctrl+N | ⌘N |
| 開く Open | Ctrl+O | ⌘O |
| 保存 Save | Ctrl+S | ⌘S |
| 名前を付けて保存 Save As | Ctrl+Shift+S | ⌘⇧S |
| ルビを挿入 Insert ruby | Ctrl+R | ⌘R |
| 次のルビへ Next ruby | Alt+↓ or Ctrl+Shift+↓ | ⌥↓ or ⌘⇧↓ |
| 前のルビへ Previous ruby | Alt+↑ or Ctrl+Shift+↑ | ⌥↑ or ⌘⇧↑ |
| ふりがなを切替 Cycle furigana | Ctrl+Shift+F | ⌘⇧F |
| 文字を大きく Larger type | Ctrl+= or Ctrl++ | ⌘= or ⌘+ |
| 文字を小さく Smaller type | Ctrl+- | ⌘- |
| 文字サイズを戻す Reset type | Ctrl+0 | ⌘0 |
| ショートカット一覧 Cheatsheet | Ctrl+/ , or `?` outside the editor | ⌘/ , or `?` |
| Menus | Alt+F E V I D H | ⌥F E V I D H |

Esc closes the cheatsheet, the ruby prompt, and menus. Enter confirms the ruby prompt and save-as dialog (not while the IME is composing). The whole table lives in `src/lib/keymap.ts`.

Insert ruby: select the kanji on the page, press the shortcut, type the furigana, Enter. Pure kanji is saved as `漢字《よみ》`. Anything else is saved as `｜食べ《た》`.

Furigana cycles **表示 → 非表示 → ホバー**. Hover keeps the furigana invisible until the pointer is on that word. There is one page, not a source pane beside a preview.

## Develop

Requirements: Node.js 22+, pnpm 10.33.4 (`packageManager` in `package.json`; Corepack picks it up), Rust **1.90+** (Tauri 2.12), and a WebKitGTK 4.1 toolchain on Linux.

### Linux

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf libssl-dev pkg-config
pnpm install
pnpm tauri:dev
```

### macOS

Install Xcode command line tools, Rust, and Node. Then:

```bash
pnpm install
pnpm tauri:dev
```

The dev server is Vite on `http://127.0.0.1:43123`. You can open that URL without the Tauri shell; open/save then uses a file input and a download. Inside the desktop shell, open/save uses native dialogs and writes UTF-8 (BOM stripped on read, atomic replace on write).

### Build

```bash
pnpm tauri:build
```

Artifacts land in `src-tauri/target/release/bundle/`.

### Install a build from main

Every push to `main` on [FredrikAugust/pe-ji](https://github.com/FredrikAugust/pe-ji) builds installers. There is no release branch and no version tag. Open the **build** workflow for that commit and download the artifact for your machine:

| Machine | File |
| --- | --- |
| Linux | `.deb` or `.AppImage` |
| Apple silicon Mac | `.dmg` (`aarch64`) |
| Intel Mac | `.dmg` (`x86_64`) |
| Windows | `.msi` or the NSIS `.exe` |

The macOS app is unsigned. The first launch is Right Click → Open. Linux and Windows packages from this workflow are unsigned too.

## Tests

```bash
cargo test          # parser fixtures + UTF-8 file IO
pnpm test           # keymap, ruby insert, navigation
pnpm e2e            # Playwright against the real UI
pnpm check          # all three
```

`pnpm e2e` covers every binding above, the three furigana modes (including hover), open/save/save-as, the dirty-close confirm, and an IME simulation (`compositionstart` suppresses Ctrl+S). A full OS IME is not available to headless Chromium; the guard itself is also unit-tested. The Tauri window itself is not driven by tauri-driver here.

## Roadmap

- Dictionary panel via the Jisho API (search, JLPT/WK tags, insert the reading).
- PDF export with furigana on or off.
- Automatic furigana for kanji you have not annotated yet.
- Configurable keymap (the table is already data-driven).
- Remember window size, font size, and the last furigana mode.

## Layout

```
crates/pico-core/     Rust parser, HTML escape, UTF-8 read/write
src-tauri/            Tauri 2 shell and file commands
src/lib/keymap.ts     one keymap
src/lib/parser.ts     same grammar as the Rust crate
testdata/ruby_cases.json
```
