import { KEYMAP, type CommandId } from "./keymap";
import { basename } from "./files";
import type { MenuItemOptions, PredefinedMenuItemOptions, SubmenuOptions } from "@tauri-apps/api/menu";

type NativeItem = MenuItemOptions | SubmenuOptions | PredefinedMenuItemOptions;

export type MenuId = "file" | "edit" | "view" | "format" | "insert" | "dict" | "help";

export interface MenuItem {
  label: string;
  command?: CommandId;
  disabled?: boolean;
  separator?: boolean;
  /** Open Recent entries carry the file path. */
  path?: string;
}

export interface MenuDef {
  id: MenuId;
  label: string;
  items: MenuItem[];
}

export const MENUS: MenuDef[] = [
  {
    id: "file",
    label: "ファイル(F)",
    items: [
      { label: "新規", command: "file.new" },
      { label: "開く", command: "file.open" },
      // Open Recent entries are inserted here by withRecent().
      { label: "保存", command: "file.save" },
      { label: "名前を付けて保存", command: "file.saveAs" },
      { label: "PDF出力", command: "file.pdf" },
      { label: "サンプルを開く", command: "file.sample" },
      { separator: true, label: "" },
      { label: "閉じる", command: "file.close" },
    ],
  },
  {
    id: "edit",
    label: "編集(E)",
    items: [
      { label: "元に戻す", command: "edit.undo" },
      { label: "やり直す", command: "edit.redo" },
      { separator: true, label: "" },
      { label: "すべて選択", command: "edit.selectAll" },
    ],
  },
  {
    id: "view",
    label: "表示(V)",
    items: [
      { label: "ふりがな：表示", command: "view.furi.show" },
      { label: "ふりがな：非表示", command: "view.furi.hide" },
      { label: "ふりがな：ホバー", command: "view.furi.hover" },
      { separator: true, label: "" },
      { label: "文字を大きく", command: "view.fontUp" },
      { label: "文字を小さく", command: "view.fontDown" },
      { label: "文字サイズを戻す", command: "view.fontReset" },
      { separator: true, label: "" },
      { label: "辞書パネル", command: "dict.toggle" },
      { label: "PDFを横に開く／閉じる", command: "view.pdf" },
    ],
  },
  {
    id: "format",
    label: "書式(O)",
    items: [
      { label: "太字", command: "format.bold" },
      { label: "斜体", command: "format.italic" },
      { separator: true, label: "" },
      { label: "大見出し", command: "format.h1" },
      { label: "中見出し", command: "format.h2" },
      { label: "小見出し", command: "format.h3" },
      { label: "本文", command: "format.body" },
      { label: "箇条書き", command: "format.bullet" },
      { separator: true, label: "" },
      { label: "字下げ", command: "format.indent" },
      { label: "字下げを戻す", command: "format.outdent" },
    ],
  },
  {
    id: "insert",
    label: "挿入(I)",
    items: [
      { label: "表を挿入", command: "insert.table" },
    ],
  },
  {
    id: "dict",
    label: "辞書(D)",
    items: [
      { label: "ことばサーチ", command: "dict.toggle" },
      { label: "選択中の語を検索", command: "dict.lookup" },
      { separator: true, label: "" },
      { label: "翻訳パネル", command: "translate.toggle" },
      { label: "選択中の文を翻訳", command: "translate.selection" },
    ],
  },
  {
    id: "help",
    label: "ヘルプ(H)",
    items: [
      { label: "ショートカット一覧", command: "help.cheatsheet" },
      { label: "ぴこぴこ作文帳について", command: "help.about" },
    ],
  },
];

export function menuCommand(id: MenuId): CommandId {
  return `menu.${id}` as CommandId;
}

export function firstEnabledIndex(menu: MenuDef): number {
  return menu.items.findIndex((item) => !item.separator && !item.disabled && item.command);
}

/** MENUS with the recent files listed after 開く. */
export function withRecent(recent: string[]): MenuDef[] {
  if (!recent.length) return MENUS;
  const items: MenuItem[] = recent.map((path) => ({ label: `　${basename(path)}`, command: "file.recent", path }));
  return MENUS.map((m) => {
    if (m.id !== "file") return m;
    const at = m.items.findIndex((i) => i.command === "file.open") + 1;
    return { ...m, items: [...m.items.slice(0, at), ...items, ...m.items.slice(at)] };
  });
}

/** Native accelerator for a command, from its first ⌘ binding. */
function accelerator(cmd: CommandId): string | undefined {
  const b = KEYMAP.find((k) => k.id === cmd && k.chord.mod && !k.chord.alt && k.when !== "editor");
  if (!b) return undefined;
  return ["CmdOrCtrl", b.chord.shift === true ? "Shift" : "", b.chord.key.toUpperCase()].filter(Boolean).join("+");
}

/**
 * The macOS menu bar mirrors MENUS. Clipboard items are the predefined ones, or
 * ⌘C/⌘V stop reaching the web view.
 */
export async function setNativeMenu(menus: MenuDef[], run: (item: MenuItem) => void): Promise<void> {
  const { Menu } = await import("@tauri-apps/api/menu");
  const entry = (i: MenuItem): NativeItem =>
    i.separator
      ? { item: "Separator" as const }
      : {
          text: i.label.trim(),
          enabled: !i.disabled,
          accelerator: i.command && !i.path ? accelerator(i.command) : undefined,
          action: () => run(i),
        };
  const submenu = (m: MenuDef): SubmenuOptions => {
    const recent = m.items.filter((i) => i.path).map(entry);
    const items = m.items.filter((i) => !i.path).map(entry);
    if (recent.length) {
      const at = m.items.findIndex((i) => i.command === "file.open") + 1;
      items.splice(at, 0, { text: "最近使ったファイル", items: recent });
    }
    if (m.id === "edit")
      items.push({ item: "Separator" }, { item: "Cut" }, { item: "Copy" }, { item: "Paste" });
    return { text: m.label.replace(/\(.\)$/, ""), items };
  };
  const menu = await Menu.new({
    items: [
      {
        text: "ぴこぴこ作文帳",
        items: [
          { item: { About: null } },
          { item: "Separator" },
          { item: "Hide" },
          { item: "HideOthers" },
          { item: "Separator" },
          { text: "終了", accelerator: "CmdOrCtrl+Q", action: () => run({ label: "", command: "file.close" }) },
        ],
      },
      ...menus.map(submenu),
    ],
  });
  await menu.setAsAppMenu();
}

/** Native right-click menu for the page. */
export async function popupContextMenu(run: (cmd: CommandId) => void): Promise<void> {
  const { Menu } = await import("@tauri-apps/api/menu");
  const menu = await Menu.new({
    items: [
      { item: "Cut" },
      { item: "Copy" },
      { item: "Paste" },
      { item: "Separator" },
      { text: "太字", action: () => run("format.bold") },
      { text: "斜体", action: () => run("format.italic") },
      { item: "Separator" },
      { text: "辞書で引く", action: () => run("dict.lookup") },
      { text: "翻訳する", action: () => run("translate.selection") },
      { item: "Separator" },
      { item: "SelectAll" },
    ],
  });
  await menu.popup();
}
