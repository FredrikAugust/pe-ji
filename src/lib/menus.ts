import type { CommandId } from "./keymap";

export type MenuId = "file" | "edit" | "view" | "insert" | "dict" | "help";

export interface MenuItem {
  label: string;
  command?: CommandId;
  disabled?: boolean;
  separator?: boolean;
  todo?: string;
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
      { label: "保存", command: "file.save" },
      { label: "名前を付けて保存", command: "file.saveAs" },
      { label: "サンプルを開く", command: "file.sample" },
      { separator: true, label: "" },
      { label: "閉じる", command: "file.close" },
    ],
  },
  {
    id: "edit",
    label: "編集(E)",
    items: [
      { label: "すべて選択", command: "edit.selectAll" },
      { separator: true, label: "" },
      { label: "ルビを挿入", command: "edit.ruby" },
      { label: "次のルビへ", command: "edit.rubyNext" },
      { label: "前のルビへ", command: "edit.rubyPrev" },
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
    ],
  },
  {
    id: "insert",
    label: "挿入(I)",
    items: [
      { label: "ルビを挿入", command: "edit.ruby" },
      { label: "自動ふりがな", disabled: true, todo: "準備中" },
    ],
  },
  {
    id: "dict",
    label: "辞書(D)",
    items: [
      { label: "ことばサーチ", disabled: true, todo: "Jisho API は次の版" },
      { label: "選択中の語を検索", disabled: true, todo: "準備中" },
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
