# ぴこぴこ作文帳

A small word processor for people learning Japanese. You write on one page with headings, bullets, bold, italic, indents and tables. Furigana sits above the kanji as you edit. The file on disk is still one plain-text file.

Repository: [FredrikAugust/pe-ji](https://github.com/FredrikAugust/pe-ji). Development is on `main`.

It has the page, automatic furigana in three modes, a Jisho dictionary panel, a PDF viewer beside the page, Aozora Bunko files, open/save, Open Recent, and PDF export (print to PDF).

The window has no OS frame; drag it by the menu bar or toolbar. The menus are mirrored into the macOS menu bar, and right-click opens a native menu. The colors follow the system light or dark appearance. Drop a `.txt` or `.md` on the window to edit it, or a PDF to read it in the resizable pane left of the page (宿題PDF). Chrome uses the bundled [DotGothic16](https://fonts.google.com/specimen/DotGothic16) pixel font. The document itself uses bundled [Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP) so the writing stays easy to read. Nothing is loaded from a CDN at runtime.

## Markup

Every line of the file is one paragraph.

| Write this | You get |
| --- | --- |
| `# 題`, `## 題`, `### 題` | heading (large, medium, small) |
| `- 項目` (or `* 項目`) | bullet |
| leading tabs | indent; Tab / Shift-Tab add and remove them |
| `**太字**`, `*斜体*` | bold, italic |
| `\| 漢字 \| かんじ \|` | table row; consecutive rows form one table |

Inside a table cell the half-width `|` separates cells, so write explicit ruby with the full-width `｜`, or use `{漢字|かんじ}`.

| Write this | Reading on |
| --- | --- |
| `漢字《かんじ》` | the kanji run directly before `《` |
| `｜食べ《た》` or `\|食べ《た》` | an explicit base (full-width or half-width pipe) |
| `{漢字\|かんじ}` | anything, brace form |

Rules the parser actually implements:

- The pipe is optional only when the base is a run of kanji (CJK ideographs, `々`, `〆`, `ヵ`, `ヶ`, and the CJK extension blocks). Okurigana blocks the implicit form: `晴れ《はれ》` is literal; write `晴《はれ》れ` or `｜晴れ《はれ》`.
- Ruby does not cross a newline. Unmatched `《》`, `{}`, or a pipe with no reading stays as literal text.
- An empty base is not ruby. An empty reading (`漢字《》`, `{漢字|}`) is ruby with an empty `<rt>`.
- A backslash escapes the next character: `\《`, `\{`, `\\`, `\|`, `\*`. A plain paragraph that starts with `# `, `- ` or a tab is written with a leading `\`.
- The page paints text nodes, not `innerHTML`, so `<` in the document cannot become markup. Paste is plain text.

The grammar lives in `src/lib/parser.ts`; `testdata/ruby_cases.json` pins the ruby cases.

Only lines you edit are written back from the page. Every other line goes back to disk byte for byte, including markup the page shows differently.

## Aozora Bunko

Open an Aozora `.txt` (unzip it first). Shift_JIS is detected, and saving writes UTF-8 with the file's original line endings. The page renders `［＃「…」は大見出し］`/`中`/`小` and `［＃大見出し］…［＃大見出し終わり］`, `［＃「…」は太字］` and `［＃太字］…［＃太字終わり］`, `［＃「…」に傍点］` (and 白ゴマ, 丸, 白丸, 二重丸, 三角 variants), and `［＃N字下げ］` at the start of a line. The notes block between the two dashed rules at the top is hidden. Any other note is hidden on the page and kept in the file.

## Furigana and dictionary

Furigana is automatic and only drawn, never written to the file. The desktop app splits each line with Lindera (embedded IPADIC) in Rust and puts the reading over the kanji only, single kanji included (食べる → 食《た》べる). Readings are cached per line for the session. The caret cannot go into a reading. Ruby already in a file (`漢字《かんじ》`, `｜食べ《た》`, `{漢字|かんじ}`) still shows and is saved back unchanged. In a plain browser (dev only) there is no tokenizer, so only file ruby shows.

The 辞書 panel searches Jisho and shows the word with furigana, JLPT level, whether it is common, each sense with its part of speech, Jisho's notes (for example "Usually written using kana alone"), other spellings, and a link to the Jisho page. In the desktop app the request goes through Rust, and every answer, misses included, is cached under the app cache folder (`jisho/`). Each word is fetched once per session in memory as well. In a plain browser (dev only) the page calls Jisho directly, which needs Jisho to allow CORS.

## Translation

翻訳 (⌘T / Ctrl+T) translates the selection, or the caret's line when nothing is selected, with DeepL: Japanese to English, anything else to Japanese. ⌘⇧T opens the panel to type into it. The first time, paste a DeepL API key into the panel; the free tier (500,000 characters a month, keys end in `:fx`) is plenty. The key is stored in the app config folder (`deepl.key`, readable only by you) and only Rust sees it. Translations are remembered for the session. Desktop app only.

## AI (MCP)

編集 → AIと接続… starts an MCP server inside the app (Streamable HTTP at `http://127.0.0.1:4417/mcp`, Bearer token required) and shows the URL and token for your MCP client (Codex, ChatGPT, a local LLM). It stays on in later runs until the token file is removed. Tools:

- `read_document`: file name, source text, current selection.
- `list_notes`, `add_note` (a note, or a correction with a suggestion), `remove_note`.
- `replace_text`: edit directly; the learner can undo it.

Quotes must match the source text exactly (`occurrence` picks between repeats). Notes are highlighted on the page and listed in the メモ panel, where a correction can be applied or dismissed. Notes live for the session only.

The server listens on localhost only; delete `mcp.token` in the app config folder to get a new token.

### Cloud AI (Grok and friends) through the relay

A cloud agent cannot reach your computer, so the app connects out to a tiny relay on Cloudflare Workers (`relay/`, free tier). The agent always uses the same `https://pico-relay.<you>.workers.dev/mcp`; whichever computer opened the app last answers, and focusing the app on the other computer takes it back.

```bash
cd relay && pnpm install
pnpm exec wrangler login
pnpm exec wrangler secret put APP_KEY   # the app's key, pasted into AIと接続… on each computer
pnpm exec wrangler secret put BOT_KEY   # the agent's Bearer token
pnpm run deploy
```

`pnpm dev` runs the relay locally and `pnpm test` checks it end to end (keys in `.dev.vars`). Anyone with BOT_KEY can read and edit the open document.

## Keybindings

Mod is **⌘ on macOS** and **Ctrl on Linux and Windows**. Shortcuts are ignored while an IME composition is active (`compositionstart` / `isComposing` / keyCode 229), and for a short moment after composition ends, so confirming a candidate does not fire the shortcut.

| Action | Linux / Windows | macOS |
| --- | --- | --- |
| 新規 New | Ctrl+N | ⌘N |
| 開く Open | Ctrl+O | ⌘O |
| 保存 Save | Ctrl+S | ⌘S |
| 名前を付けて保存 Save As | Ctrl+Shift+S | ⌘⇧S |
| PDF出力 Export PDF (print) | Ctrl+P | ⌘P |
| 閉じる Close | Ctrl+W | ⌘W |
| すべて選択 Select all | Ctrl+A | ⌘A or Ctrl+A |
| 太字 / 斜体 Bold / italic | Ctrl+B / Ctrl+I | ⌘B / ⌘I |
| 見出し Heading 1–3 (again for body text) | Ctrl+1 / 2 / 3 | ⌘1 / 2 / 3 |
| 箇条書き Bullet | Ctrl+Shift+8 | ⌘⇧8 |
| 字下げ Indent / outdent (next / previous cell in a table) | Tab / Shift+Tab | Tab / ⇧Tab |
| 元に戻す / やり直す Undo / redo | Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y | ⌘Z / ⌘⇧Z |
| 辞書で引く Look up selection | Ctrl+D | ⌘D |
| 翻訳 Translate selection or line | Ctrl+T | ⌘T |
| 翻訳パネル Translate panel | Ctrl+Shift+T | ⌘⇧T |
| ふりがなを切替 Cycle furigana | Ctrl+Shift+F | ⌘⇧F |
| 文字を大きく Larger type | Ctrl+= or Ctrl++ | ⌘= or ⌘+ |
| 文字を小さく Smaller type | Ctrl+- | ⌘- |
| 文字サイズを戻す Reset type | Ctrl+0 | ⌘0 |
| ショートカット一覧 Cheatsheet | Ctrl+/ , or `?` outside the editor | ⌘/ , or `?` |
| Menus | Alt+F E V O I D H | ⌥F E V O I D H |

Esc closes dialogs and menus. Enter confirms the save-as dialog (not while the IME is composing). The whole table lives in `src/lib/keymap.ts`.

Enter on a bullet continues the list; Enter on an empty bullet ends it. Backspace at the start of a bullet or heading removes the marker first, then one indent. Enter in a table adds a row; Enter in an empty row leaves the table. Copy and paste carry the markup.

Furigana cycles **表示 → 非表示 → ホバー**, and the choice is remembered. Hover keeps the furigana invisible until the pointer is on that word. There is one page, not a source pane beside a preview.

## Develop

Requirements: Node.js 22+, pnpm 12.18.0 (`packageManager` in `package.json`; Corepack and CI pick it up), Rust **1.90+** (Tauri 2.12), and a WebKitGTK 4.1 toolchain on Linux.

pnpm only installs versions that have been on the registry for at least 7 days (`minimumReleaseAge` in `pnpm-workspace.yaml`). That matches Aikido's cooldown. The `vite` and `@playwright/test` ranges include a release from before that window.

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

The dev server is Vite on `http://127.0.0.1:43123`. You can open that URL without the Tauri shell; open/save then uses a file input and a download. Inside the desktop shell, open/save uses native dialogs and writes UTF-8 (BOM stripped on read, atomic replace on write). The window has a content security policy; `tauri dev` runs without it.

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
cargo test          # atomic file write, Lindera readings
pnpm test           # parser, edits, furigana alignment, decoding, keymap
pnpm e2e            # Playwright against the real UI
pnpm check          # all three
```

`pnpm e2e` covers formatting, indents, tables, Aozora files, the dictionary (Jisho is mocked), automatic furigana (the tokenizer is stubbed), print layout, every binding above, the three furigana modes (including hover), open/save/save-as, the dirty-close confirm, and an IME simulation (`compositionstart` suppresses Ctrl+S). A full OS IME is not available to headless Chromium; the guard itself is also unit-tested. The Tauri window itself is not driven by tauri-driver here.

## Roadmap

- Configurable keymap (the table is already data-driven).
- Remember window size and font size.

## Layout

```
src-tauri/            Tauri 2 shell: file bytes, atomic write, Lindera readings, cached Jisho fetch
src/lib/parser.ts     the file grammar (lines, ruby, emphasis, Aozora notes)
src/lib/edit.ts       source-level commands (blocks, indent, tables)
src/lib/furigana.ts   automatic readings (cache, okurigana alignment)
src/ui/render.ts      source line <-> DOM
src/ui/Page.tsx       the editable page
src/lib/keymap.ts     one keymap
testdata/ruby_cases.json
```
