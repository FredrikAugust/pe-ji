import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const ARTIFACTS = "/opt/cursor/artifacts";

async function editor(page: Page) {
  const box = page.getByTestId("editor");
  await expect(box).toBeVisible();
  return box;
}

async function chord(page: Page, key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}) {
  if (mods.ctrl) await page.keyboard.down("Control");
  if (mods.meta) await page.keyboard.down("Meta");
  if (mods.shift) await page.keyboard.down("Shift");
  if (mods.alt) await page.keyboard.down("Alt");
  await page.keyboard.press(key);
  if (mods.alt) await page.keyboard.up("Alt");
  if (mods.shift) await page.keyboard.up("Shift");
  if (mods.meta) await page.keyboard.up("Meta");
  if (mods.ctrl) await page.keyboard.up("Control");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app")).toHaveAttribute("data-furigana-mode", "show");
  await expect(page.getByTestId("editor").locator("ruby").first()).toBeVisible();
});

test("renders the sample diary with real ruby on the page you edit", async ({ page }) => {
  await expect(page.getByTestId("title")).toContainText("十一月の日記.txt — ぴこぴこ作文帳");
  await expect(page.getByTestId("title")).not.toContainText("*");
  const editor = page.getByTestId("editor");
  await expect(editor.locator("rt").filter({ hasText: "きのう" }).first()).toBeVisible();
  await expect(page.locator(".pane")).toHaveCount(0);
  await expect(page.getByTestId("status-furi")).toHaveText("ふりがな：表示");
  await expect(page.getByTestId("btn-dict")).toBeDisabled();
  await expect(page.getByTestId("btn-pdf")).toBeDisabled();
  await expect(page.getByText("準備中").first()).toBeVisible();
});

test("cycles furigana modes and reveals readings on hover", async ({ page }) => {
  const editor = page.getByTestId("editor");
  const rt = editor.locator("rt").first();
  await expect(rt).toBeVisible();

  await chord(page, "f", { ctrl: true, shift: true });
  await expect(page.getByTestId("app")).toHaveAttribute("data-furigana-mode", "hide");
  await expect(rt).toBeHidden();
  await expect(page.getByTestId("status-furi")).toHaveText("ふりがな：非表示");

  await chord(page, "f", { ctrl: true, shift: true });
  await expect(page.getByTestId("app")).toHaveAttribute("data-furigana-mode", "hover");
  const ruby = editor.locator("ruby").nth(2);
  await expect.poll(async () => ruby.locator("rt").evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  await ruby.hover();
  await expect.poll(async () => Number(await ruby.locator("rt").evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.9);

  await page.getByTestId("btn-furi").click();
  await expect(page.getByTestId("app")).toHaveAttribute("data-furigana-mode", "show");
});

test("changes document font size from the keyboard", async ({ page }) => {
  const box = await editor(page);
  const size = async () => box.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await size()).toBe(18);
  await chord(page, "=", { ctrl: true });
  expect(await size()).toBe(20);
  await chord(page, "+", { ctrl: true, shift: true });
  expect(await size()).toBe(22);
  await chord(page, "-", { ctrl: true });
  expect(await size()).toBe(20);
  await chord(page, "0", { ctrl: true });
  expect(await size()).toBe(18);
});

test("opens the cheatsheet from Ctrl+/ and from ?", async ({ page }) => {
  await chord(page, "/", { ctrl: true });
  const sheet = page.getByTestId("cheatsheet");
  await expect(sheet).toBeVisible();
  for (const label of ["新規", "ルビを挿入", "ふりがなを切替", "ショートカット一覧", "名前を付けて保存"]) {
    await expect(sheet).toContainText(label);
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await page.getByTestId("btn-new").focus();
  await page.keyboard.press("?");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("?");
  await expect(sheet).toBeHidden();
});

test("does not open the cheatsheet when ? is typed in the editor", async ({ page }) => {
  const box = await editor(page);
  await box.focus();
  await page.keyboard.press("End");
  await page.keyboard.insertText("?");
  await expect(page.getByTestId("cheatsheet")).toHaveCount(0);
  await expect(box).toHaveAttribute("data-markup", /日記\?/);
});

async function readingAtSelection(page: Page) {
  return page.getByTestId("editor").evaluate(() => {
    const sel = getSelection();
    const node = sel?.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement;
    return el?.closest("ruby")?.querySelector("rt")?.textContent ?? "";
  });
}

test("inserts ruby around the selection and jumps between entries", async ({ page }) => {
  const box = await editor(page);
  await box.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.parentElement?.closest("rt")) {
        node = walker.nextNode();
        continue;
      }
      const text = node.textContent ?? "";
      const i = text.indexOf("十一月");
      if (i >= 0) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 3);
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        break;
      }
      node = walker.nextNode();
    }
  });
  await chord(page, "r", { ctrl: true });
  await expect(page.getByTestId("ruby-prompt")).toBeVisible();
  await expect(page.getByTestId("ruby-base")).toHaveText("十一月");
  await page.getByTestId("ruby-input").fill("じゅういちがつ");
  await page.getByTestId("ruby-input").press("Enter");
  await expect(box).toHaveAttribute("data-markup", /十一月《じゅういちがつ》/);
  await expect(box.locator("rt", { hasText: "じゅういちがつ" })).toBeVisible();
  await expect(page.getByTestId("title")).toContainText("*");

  await box.evaluate((el) => {
    const range = document.createRange();
    range.setStart(el, 0);
    range.collapse(true);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
  await chord(page, "ArrowDown", { alt: true });
  const selected = await readingAtSelection(page);
  expect(selected.length).toBeGreaterThan(0);
  await chord(page, "ArrowDown", { ctrl: true, shift: true });
  const second = await readingAtSelection(page);
  expect(second).not.toBe(selected);
  expect(second.length).toBeGreaterThan(0);
});

test("asks before discarding unsaved work", async ({ page }) => {
  const box = await editor(page);
  await box.focus();
  await page.keyboard.press("End");
  await page.keyboard.insertText("！");
  await expect(page.getByTestId("app")).toHaveAttribute("data-dirty", "yes");

  await chord(page, "n", { ctrl: true });
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-cancel").click();
  await expect(box).toHaveAttribute("data-markup", /日記！/);

  await page.getByTestId("btn-new").click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-discard").click();
  await expect(box).toHaveAttribute("data-markup", "");
  await expect(box).toHaveAttribute("data-empty", "yes");
  await expect(page.getByTestId("title")).toContainText("無題.txt");
  await expect(page.getByTestId("app")).toHaveAttribute("data-dirty", "no");
});

test("saves and saves-as via download, then opens a file", async ({ page }) => {
  const box = await editor(page);
  const first = page.waitForEvent("download");
  await chord(page, "s", { ctrl: true });
  const saved = await first;
  expect(saved.suggestedFilename()).toBe("十一月の日記.txt");
  expect(await saved.createReadStream().then(readAll)).toContain("昨日《きのう》");

  await chord(page, "s", { ctrl: true, shift: true });
  await expect(page.getByTestId("saveas-dialog")).toBeVisible();
  await page.getByTestId("saveas-input").fill("haru");
  const second = page.waitForEvent("download");
  await page.getByTestId("saveas-input").press("Enter");
  const renamed = await second;
  expect(renamed.suggestedFilename()).toBe("haru.txt");
  await expect(page.getByTestId("title")).toContainText("haru.txt");

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("btn-open").click(),
  ]);
  await chooser.setFiles({
    name: "yomikata.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("試験《しけん》です\n{歩く|あるく}", "utf-8"),
  });
  await expect(box).toHaveAttribute("data-markup", "試験《しけん》です\n{歩く|あるく}");
  await expect(box.locator("rt").nth(0)).toHaveText("しけん");
  await expect(box.locator("rt").nth(1)).toHaveText("あるく");
  await expect(page.getByTestId("title")).toContainText("yomikata.txt");
  await expect(page.getByTestId("status-message")).toHaveText("開きました");
});

test("keeps literal text when brackets are unmatched and escapes HTML", async ({ page }) => {
  const box = await editor(page);
  await box.fill("漢字《かん\n<script>");
  await expect(box.locator("ruby")).toHaveCount(0);
  await expect(box).toContainText("漢字《かん");
  await expect(box).toContainText("<script>");
  const html = await box.innerHTML();
  expect(html).not.toContain("<script>");
});

test("menu keyboard opens the cheatsheet and Alt shortcuts reach menus", async ({ page }) => {
  await page.getByTestId("menu-help").click();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cheatsheet")).toBeVisible();
  await page.keyboard.press("Escape");

  await chord(page, "f", { alt: true });
  await expect(page.getByRole("menuitem", { name: /新規/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: /新規/ })).toHaveCount(0);
});

test("ignores shortcuts during IME composition", async ({ page }) => {
  const box = await editor(page);
  await box.focus();
  await page.keyboard.press("End");
  await page.keyboard.insertText("あ");
  await expect(page.getByTestId("app")).toHaveAttribute("data-dirty", "yes");

  await box.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
  });
  await expect(page.getByTestId("ime")).toHaveText("あ");
  const leaked = page.waitForEvent("download", { timeout: 600 }).catch(() => null);
  await chord(page, "s", { ctrl: true });
  expect(await leaked).toBeNull();
  await expect(page.getByTestId("app")).toHaveAttribute("data-dirty", "yes");

  await box.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "あ" }));
  });
  await page.waitForTimeout(80);
  const download = page.waitForEvent("download");
  await chord(page, "s", { ctrl: true });
  expect((await download).suggestedFilename()).toContain(".txt");
  await expect(page.getByTestId("ime")).toHaveText("A");
});

test("close button asks before throwing away edits", async ({ page }) => {
  const box = await editor(page);
  await box.focus();
  await page.keyboard.insertText("x");
  await page.getByRole("button", { name: "閉じる" }).click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-cancel").click();
  await expect(box).toHaveAttribute("data-markup", /x/);
});

test("screenshots of furigana modes and the cheatsheet", async ({ page }) => {
  await mkdir(ARTIFACTS, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${ARTIFACTS}/furigana_shown.png` });

  await chord(page, "f", { ctrl: true, shift: true });
  await expect(page.getByTestId("app")).toHaveAttribute("data-furigana-mode", "hide");
  await page.screenshot({ path: `${ARTIFACTS}/furigana_hidden.png` });

  await chord(page, "f", { ctrl: true, shift: true });
  await expect(page.getByTestId("app")).toHaveAttribute("data-furigana-mode", "hover");
  const ruby = page.getByTestId("editor").locator("ruby").nth(3);
  await ruby.hover();
  await page.screenshot({ path: `${ARTIFACTS}/furigana_hover.png` });

  await chord(page, "/", { ctrl: true });
  await expect(page.getByTestId("cheatsheet")).toBeVisible();
  await page.screenshot({ path: `${ARTIFACTS}/cheatsheet.png` });
});

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
