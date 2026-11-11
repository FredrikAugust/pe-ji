import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const ARTIFACTS = process.env.E2E_ARTIFACTS ?? "test-results/screens";

async function markup(page: Page): Promise<string> {
  return page.getByTestId("editor").evaluate((el) => (el as HTMLElement & { markup: string }).markup);
}

async function placeCaret(page: Page, needle: string, where: "start" | "end" | "select" = "end") {
  await page.getByTestId("editor").evaluate(
    (el, [needle, where]) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest("rt")) continue;
        const i = (node.textContent ?? "").indexOf(needle);
        if (i < 0) continue;
        const sel = getSelection()!;
        (el as HTMLElement).focus();
        if (where === "select") sel.setBaseAndExtent(node, i, node, i + needle.length);
        else sel.collapse(node, where === "start" ? i : i + needle.length);
        return;
      }
      throw new Error(`not on page: ${needle}`);
    },
    [needle, where] as const,
  );
}

async function setDoc(page: Page, text: string) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("btn-open").click()]);
  await chooser.setFiles({ name: "doc.txt", mimeType: "text/plain", buffer: Buffer.from(text, "utf-8") });
  await expect.poll(() => markup(page)).toBe(text);
}

async function editor(page: Page) {
  const box = page.getByTestId("editor");
  await expect(box).toBeVisible();
  return box;
}

async function chord(page: Page, key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}) {
  if (mods.ctrl) await page.keyboard.down("ControlOrMeta");
  if (mods.meta) await page.keyboard.down("Meta");
  if (mods.shift) await page.keyboard.down("Shift");
  if (mods.alt) await page.keyboard.down("Alt");
  await page.keyboard.press(key);
  if (mods.alt) await page.keyboard.up("Alt");
  if (mods.shift) await page.keyboard.up("Shift");
  if (mods.meta) await page.keyboard.up("Meta");
  if (mods.ctrl) await page.keyboard.up("ControlOrMeta");
}

test.beforeEach(async ({ page }) => {
  // No test reaches Jisho, DeepL or anything else off this machine; tests that need Jisho mock it on top.
  await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
  await page.goto("/");
  await expect(page).toHaveTitle("pe-ji");
  await page.getByTestId("welcome").getByRole("button", { name: "サンプルを開く" }).click();
  await expect(page.getByTestId("app")).toHaveAttribute("data-furigana-mode", "show");
  await expect(page.getByTestId("editor").locator("ruby").first()).toBeVisible();
});

test("renders the sample diary with real ruby on the page you edit", async ({ page }) => {
  await expect(page).toHaveTitle("十一月の日記.txt — pe-ji");
  await expect(page.locator(".titlebar, .banner, .caps")).toHaveCount(0);
  const editor = page.getByTestId("editor");
  await expect(editor.locator('rt[data-r="きのう"]').first()).toBeVisible();
  await expect(page.locator(".pane")).toHaveCount(0);
  await expect(page.getByTestId("status-furi")).toHaveText("ふりがな：表示");
  await expect(page.getByTestId("btn-pdf")).toBeEnabled();
  await expect(page.getByTestId("dict")).toBeVisible();
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
  for (const label of ["新規", "PDF出力", "ふりがなを切替", "ショートカット一覧", "名前を付けて保存"]) {
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
  await editor(page);
  await placeCaret(page, "十一月の日記");
  await page.keyboard.insertText("?");
  await expect(page.getByTestId("cheatsheet")).toHaveCount(0);
  await expect.poll(() => markup(page)).toMatch(/日記\?/);
});

test("asks before discarding unsaved work", async ({ page }) => {
  const box = await editor(page);
  await placeCaret(page, "十一月の日記");
  await page.keyboard.insertText("！");
  await expect(page.getByTestId("app")).toHaveAttribute("data-dirty", "yes");

  await chord(page, "n", { ctrl: true });
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-cancel").click();
  await expect.poll(() => markup(page)).toMatch(/日記！/);

  await page.getByTestId("btn-new").click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-discard").click();
  await expect.poll(() => markup(page)).toBe("");
  await expect(box).toHaveAttribute("data-empty", "yes");
  await expect(page).toHaveTitle(/無題\.txt/);
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
  await expect(page).toHaveTitle(/haru\.txt/);

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("btn-open").click(),
  ]);
  await chooser.setFiles({
    name: "yomikata.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("試験《しけん》です\n{歩く|あるく}", "utf-8"),
  });
  await expect.poll(() => markup(page)).toBe("試験《しけん》です\n{歩く|あるく}");
  await expect(box.locator("rt").nth(0)).toHaveAttribute("data-r", "しけん");
  await expect(box.locator("rt").nth(1)).toHaveAttribute("data-r", "あるく");
  await expect(page).toHaveTitle(/yomikata\.txt/);
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

test("closing asks before throwing away edits", async ({ page }) => {
  const box = await editor(page);
  await box.focus();
  await page.keyboard.insertText("x");
  await page.getByTestId("menu-file").click();
  await page.getByRole("menuitem", { name: /閉じる/ }).click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-cancel").click();
  await expect.poll(() => markup(page)).toMatch(/x/);
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

const JISHO: Record<string, { word: string; reading: string; jlpt?: string; pos: string; en: string }[]> = {
  昨日: [{ word: "昨日", reading: "きのう", jlpt: "jlpt-n5", pos: "Noun", en: "yesterday" }],
  公園: [{ word: "公園", reading: "こうえん", jlpt: "jlpt-n5", pos: "Noun", en: "park" }],
  勉強: [{ word: "勉強", reading: "べんきょう", jlpt: "jlpt-n5", pos: "Noun, Suru verb", en: "study" }],
};

async function mockJisho(page: Page) {
  const calls: string[] = [];
  await page.route("https://jisho.org/api/v1/search/words?*", (route) => {
    const keyword = new URL(route.request().url()).searchParams.get("keyword") ?? "";
    calls.push(keyword);
    const data = (JISHO[keyword] ?? []).map((e) => ({
      japanese: [{ word: e.word, reading: e.reading }],
      jlpt: e.jlpt ? [e.jlpt] : [],
      is_common: true,
      senses: [{ english_definitions: [e.en], parts_of_speech: [e.pos], tags: ["Usually written using kana alone"], info: [] }],
    }));
    return route.fulfill({ json: { data }, headers: { "access-control-allow-origin": "*" } });
  });
  return calls;
}

test("headings, bullets, bold and italic round-trip through the page", async ({ page }) => {
  await setDoc(page, "見出し\n本文です");
  await placeCaret(page, "見出し");
  await chord(page, "1", { ctrl: true });
  await expect.poll(() => markup(page)).toBe("# 見出し\n本文です");
  await expect(page.getByTestId("editor").locator(".ln.h1")).toHaveText("見出し");

  await placeCaret(page, "本文です");
  await chord(page, "8", { ctrl: true, shift: true });
  await expect.poll(() => markup(page)).toBe("# 見出し\n- 本文です");
  await page.keyboard.press("Enter");
  await page.keyboard.type("次");
  await expect.poll(() => markup(page)).toBe("# 見出し\n- 本文です\n- 次");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("終");
  await expect.poll(() => markup(page)).toBe("# 見出し\n- 本文です\n- 次\n終");

  await placeCaret(page, "本文", "select");
  await chord(page, "b", { ctrl: true });
  await expect.poll(() => markup(page)).toBe("# 見出し\n- **本文**です\n- 次\n終");
  await placeCaret(page, "次", "select");
  await page.getByTestId("btn-italic").click();
  await expect.poll(() => markup(page)).toBe("# 見出し\n- **本文**です\n- *次*\n終");

  await placeCaret(page, "見出し", "end");
  await page.keyboard.press("Enter");
  await page.keyboard.type("下");
  await expect.poll(() => markup(page)).toBe("# 見出し\n下\n- **本文**です\n- *次*\n終");
  await expect(page.getByTestId("editor").locator("b")).toHaveText("本文");

  await chord(page, "z", { ctrl: true });
  await expect.poll(() => markup(page)).toBe("# 見出し\n\n- **本文**です\n- *次*\n終");
});

test("Tab indents like Pages and Backspace drops the bullet first", async ({ page }) => {
  await setDoc(page, "一\n- 二");
  await placeCaret(page, "一", "start");
  await page.keyboard.press("Tab");
  await expect.poll(() => markup(page)).toBe("\t一\n- 二");
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => markup(page)).toBe("一\n- 二");
  await placeCaret(page, "二", "start");
  await page.keyboard.press("Tab");
  await expect.poll(() => markup(page)).toBe("一\n\t- 二");
  await page.keyboard.press("Backspace");
  await expect.poll(() => markup(page)).toBe("一\n\t二");
  await page.keyboard.press("Backspace");
  await expect.poll(() => markup(page)).toBe("一\n二");
});

test("inserts a table, types into cells, and Tab walks the cells", async ({ page }) => {
  await setDoc(page, "表の前");
  await placeCaret(page, "表の前");
  await page.getByTestId("btn-table").click();
  await expect(page.getByTestId("editor").locator("td")).toHaveCount(6);
  await page.keyboard.type("漢字");
  await page.keyboard.press("Tab");
  await page.keyboard.type("かんじ");
  await expect.poll(() => markup(page)).toBe("表の前\n| 漢字 | かんじ |  |\n|  |  |  |\n");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Tab");
  await expect(page.getByTestId("editor").locator("tr")).toHaveCount(3);
  await page.keyboard.type("ok");
  await expect.poll(() => markup(page)).toBe("表の前\n| 漢字 | かんじ |  |\n|  |  |  |\n| ok |  |  |\n");
});

test("typing next to ruby stays outside it", async ({ page }) => {
  await setDoc(page, "昨日《きのう》は");
  await placeCaret(page, "昨日", "end");
  await page.keyboard.type("x");
  await expect.poll(() => markup(page)).toBe("昨日《きのう》xは");
});

test("opens a Shift_JIS Aozora text without raw notes and saves it back intact", async ({ page }) => {
  const rule = "-".repeat(55);
  const lines = [
    "吾輩は猫である",
    "夏目漱石",
    "",
    rule,
    "【テキスト中に現れる記号について】",
    "《》：ルビ",
    "（例）吾輩《わがはい》",
    rule,
    "",
    "［＃８字下げ］一［＃「一」は中見出し］",
    "",
    "　吾輩《わがはい》は猫である。名前はまだ無い。",
    "　どこで生れたかとんと見当［＃「見当」に傍点］がつかぬ。［＃太字］強い［＃太字終わり］※［＃「てへん＋劣」、第3水準1-84-77］",
  ];
  const source = lines.join("\r\n") + "\r\n";
  const sjis = new TextEncoder().encode(source);
  // Encode to Shift_JIS in the page, where the encoder table lives.
  const bytes = await page.evaluate(async (text) => {
    const enc = Array.from(text).map((ch) => ch);
    const decoder = new TextDecoder("shift_jis");
    const map = new Map<string, number[]>();
    for (let hi = 0x81; hi <= 0xfc; hi++) {
      for (let lo = 0x40; lo <= 0xfc; lo++) {
        const ch = decoder.decode(new Uint8Array([hi, lo]));
        if (ch.length === 1 && !map.has(ch)) map.set(ch, [hi, lo]);
      }
    }
    const out: number[] = [];
    for (const ch of enc) {
      const code = ch.charCodeAt(0);
      if (code < 0x80) out.push(code);
      else out.push(...(map.get(ch) ?? [0x81, 0x48]));
    }
    return out;
  }, source);
  expect(bytes.length).toBeLessThan(sjis.length);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("btn-open").click()]);
  await chooser.setFiles({ name: "wagahai.txt", mimeType: "text/plain", buffer: Buffer.from(bytes) });

  const box = page.getByTestId("editor");
  await expect.poll(() => markup(page)).toBe(lines.join("\n") + "\n");
  await expect(box.locator(".ln.h2")).toHaveText("一");
  await expect(box.locator(".dot")).toHaveText("見当");
  await expect(box.locator(".az-b")).toHaveText("強い");
  const shown = await box.evaluate((el) => (el as HTMLElement).innerText);
  expect(shown).not.toContain("［＃");
  expect(shown).not.toContain("記号について");
  expect(shown).toContain("名前はまだ無い");
  await expect(box.locator('rt[data-r="わがはい"]')).toBeVisible();

  await placeCaret(page, "名前はまだ無い");
  await page.keyboard.type("！");
  const download = page.waitForEvent("download");
  await chord(page, "s", { ctrl: true });
  const saved = await readAll(await (await download).createReadStream());
  expect(saved).toBe(source.replace("まだ無い。", "まだ無い！。"));
});

/** Stand-in for the Rust tokenizer: katakana readings for a few known words. */
async function stubReadings(page: Page) {
  await page.evaluate(() => {
    const words: [string, string][] = [["昨日", "キノウ"], ["食べ", "タベ"], ["日", "ヒ"]];
    (window as unknown as { __picoReadings: unknown }).__picoReadings = async (lines: string[]) =>
      lines.map((line) => {
        const out: [number, number, string][] = [];
        for (let i = 0; i < line.length; ) {
          const hit = words.find(([w]) => line.startsWith(w, i));
          if (hit) out.push([i, i + hit[0].length, hit[1]]);
          i += hit ? hit[0].length : 1;
        }
        return out;
      });
  });
}

test("shows readings automatically, single kanji too, and never writes them", async ({ page }) => {
  await stubReadings(page);
  await setDoc(page, "昨日は日が出た。食べた。");
  const box = page.getByTestId("editor");
  for (const r of ["きのう", "ひ", "た"]) await expect(box.locator(`ruby[data-auto] rt[data-r="${r}"]`).first()).toBeVisible();
  await expect(box.locator("ruby[data-auto]", { hasText: "食" })).not.toContainText("べ");

  await placeCaret(page, "べた。", "end");
  await page.keyboard.insertText("よ");
  await expect.poll(() => markup(page)).toBe("昨日は日が出た。食べた。よ");

  // A caret that lands in a reading (WebKit can put it there) moves after the word.
  await box.locator('ruby[data-auto] rt[data-r="きのう"]').evaluate((rt) => getSelection()!.collapse(rt, 0));
  await page.keyboard.insertText("X");
  await expect.poll(() => markup(page)).toBe("昨日Xは日が出た。食べた。よ");

  await chord(page, "f", { ctrl: true, shift: true });
  await expect(box.locator("ruby[data-auto] rt").first()).toBeHidden();
});

test("a line break from the IME continues the bullet", async ({ page }) => {
  await setDoc(page, "- 一つ目");
  await placeCaret(page, "一つ目");
  await page.getByTestId("editor").evaluate((el) => {
    el.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertLineBreak", bubbles: true, cancelable: true }));
  });
  await expect.poll(() => markup(page)).toBe("- 一つ目\n- ");
});

test("Ctrl+A selects the whole page", async ({ page }) => {
  await setDoc(page, "一行目\n二行目");
  await placeCaret(page, "一行目");
  await page.keyboard.press("Control+a");
  await expect.poll(() => page.evaluate(() => getSelection()!.toString().replace(/\s/g, ""))).toBe("一行目二行目");
});

test("PDF output prints only the page", async ({ page }) => {
  await page.emulateMedia({ media: "print" });
  for (const id of ["dict"]) await expect(page.getByTestId(id)).toBeHidden();
  await expect(page.locator(".menubar, .tb, .status")).toHaveCount(3);
  for (const sel of [".menubar", ".tb", ".status"]) await expect(page.locator(sel)).toBeHidden();
  await expect(page.getByTestId("editor")).toBeVisible();
});

test("searches Jisho once per word with furigana, notes and a link", async ({ page }) => {
  const calls = await mockJisho(page);
  await setDoc(page, "公園を散歩した。");
  await placeCaret(page, "公園", "select");
  await chord(page, "d", { ctrl: true });
  const results = page.getByTestId("dict-results");
  await expect(results.locator(".headword rt")).toHaveText("こうえん");
  await expect(results).toContainText("JLPT N5");
  await expect(results).toContainText("よく使う");
  await expect(results).toContainText("park");
  await expect(results).toContainText("Usually written using kana alone");
  await expect(results.getByRole("link", { name: /Jisho/ })).toHaveAttribute("href", "https://jisho.org/search/%E5%85%AC%E5%9C%92");
  await expect(results.getByRole("button", { name: "ふりがなを挿入" })).toHaveCount(0);

  await page.getByTestId("dict-input").fill("公園");
  await page.getByTestId("dict-input").press("Enter");
  await expect(results).toContainText("park");
  expect(calls).toEqual(["公園"]);

  await page.getByTestId("dict-input").fill("存在しない");
  await page.getByTestId("dict-input").press("Enter");
  await expect(results).toContainText("見つかりませんでした");
});

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

test("opens a PDF beside the page and closes it", async ({ page }) => {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("btn-pdfview").click()]);
  await chooser.setFiles({ name: "宿題.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  const pane = page.getByTestId("pdfpane");
  await expect(pane).toContainText("宿題.pdf");
  await page.getByRole("button", { name: "PDFを閉じる" }).click();
  await expect(pane).toHaveCount(0);
});

async function openHomework(page: Page) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("btn-pdfview").click()]);
  await chooser.setFiles("testdata/homework.pdf");
  const view = page.getByTestId("pdf-view");
  await expect(view.locator(".pdf-page")).toHaveCount(2);
  // Drawn (some dark pixels) and selectable (a text layer with the words).
  await expect
    .poll(() =>
      view.locator("canvas").first().evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        let dark = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
        return dark;
      }),
    )
    .toBeGreaterThan(500);
  await expect(view.locator(".textLayer").first()).toContainText("友達と公園を散歩しました。");
  return view;
}

const pageWidth = (view: ReturnType<Page["getByTestId"]>) => view.locator(".pdf-page").first().evaluate((el) => el.getBoundingClientRect().width);

test("the PDF draws its pages, keeps text selectable, and pinch-zooms around the pointer", async ({ page }) => {
  const view = await openHomework(page);
  const before = await pageWidth(view);
  const box = (await view.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  // A trackpad pinch in Chromium: wheel events with ctrlKey.
  await page.keyboard.down("Control");
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -20);
  await expect.poll(() => pageWidth(view)).toBeGreaterThan(before * 2);
  expect(Number(await view.getAttribute("data-zoom"))).toBeGreaterThan(2);
  // Zoomed around the pointer: the view scrolled right, not stuck at the left edge.
  expect(await view.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  // A plain wheel still scrolls.
  const top = await view.evaluate((el) => el.scrollTop);
  await page.keyboard.up("Control");
  await page.mouse.wheel(0, 300);
  await expect.poll(() => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(top);
});

test("copying from the PDF gives kanji Jisho can find, and dragging the splitter selects nothing", async ({ page }) => {
  const view = await openHomework(page);
  const copied = await view.evaluate((el) => {
    const spans = [...el.querySelectorAll(".textLayer span")];
    const from = spans.find((s) => s.textContent!.startsWith("昨"))!;
    const to = spans.find((s) => s.textContent!.includes("散歩"))!;
    const r = document.createRange();
    r.setStartBefore(from);
    r.setEndAfter(to);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
    let out = "";
    document.addEventListener("copy", (e) => (out = e.clipboardData!.getData("text/plain")));
    const e = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    el.dispatchEvent(e);
    return out;
  });
  expect(copied).toContain("昨日、友達と公園を散歩しました。");

  await page.evaluate(() => getSelection()!.removeAllRanges());
  const s = (await page.getByTestId("pdf-splitter").boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + 300);
  await page.mouse.down();
  await page.mouse.move(s.x - 150, s.y + 500, { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection()!.toString())).toBe("");
});

test("a PDF with a non-embedded Japanese font loads its CMap and shows its text", async ({ page }) => {
  const cmap = page.waitForRequest(/UniJIS-UCS2-H.*\.bcmap/);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("btn-pdfview").click()]);
  await chooser.setFiles("testdata/cmap.pdf");
  await cmap;
  await expect(page.getByTestId("pdf-view").locator(".textLayer")).toContainText("宿題です");
});

test("the PDF pinch-zooms with WebKit's gesture events @webkit", async ({ page }) => {
  const view = await openHomework(page);
  const before = await pageWidth(view);
  await view.evaluate((el) => {
    const send = (type: string, scale: number) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(e, { scale, clientX: 200, clientY: 300 });
      el.dispatchEvent(e);
    };
    send("gesturestart", 1);
    for (const s of [1.2, 1.6, 2]) send("gesturechange", s);
    send("gestureend", 2);
  });
  await expect.poll(() => pageWidth(view)).toBeCloseTo(before * 2, 0);
});

test("Ctrl+T translates the selection, opens an empty box without one, and asks for a key", async ({ page }) => {
  await page.evaluate(() => {
    const w = window as unknown as { __picoTranslate: unknown; calls: string[] };
    w.calls = [];
    w.__picoTranslate = async (text: string, target: string) => {
      w.calls.push(`${target}:${text}`);
      if (text.startsWith("鍵")) throw "NO_KEY";
      return JSON.stringify({ translations: [{ text: "I studied yesterday.", detected_source_language: "JA" }] });
    };
  });
  await setDoc(page, "- 昨日《きのう》勉強した。\n鍵");
  const calls = () => page.evaluate(() => (window as unknown as { calls: string[] }).calls);
  await placeCaret(page, "勉強");
  await chord(page, "t", { ctrl: true });
  await expect(page.getByTestId("translate-input")).toBeFocused();
  await expect(page.getByTestId("translate-input")).toHaveValue("");
  expect(await calls()).toEqual([]);

  await placeCaret(page, "勉強した。", "select");
  await chord(page, "t", { ctrl: true });
  await expect(page.getByTestId("translate-result")).toHaveText("I studied yesterday.");
  await chord(page, "t", { ctrl: true });
  expect(await calls()).toEqual(["EN-US:勉強した。"]);

  // One button flips JP→EN to EN→JP and translates the same text again.
  const dir = page.getByTestId("translate-direction");
  await expect(dir).toHaveText("日→英");
  await dir.click();
  await expect(dir).toHaveText("英→日");
  await expect.poll(calls).toEqual(["EN-US:勉強した。", "JA:勉強した。"]);

  await placeCaret(page, "鍵", "select");
  await chord(page, "t", { ctrl: true });
  await expect(page.getByTestId("translate-result")).toContainText("API キー");
  await expect(page.getByTestId("deepl-key")).toBeVisible();
});

test("AI notes highlight the quote, and a correction can be applied", async ({ page }) => {
  await setDoc(page, "昨日、学校に行きます。\n学校は楽しい。");
  const mcp = (event: string, payload: object) =>
    page.evaluate(([e, p]) => (window as unknown as { __picoMcp: (e: string, p: object) => void }).__picoMcp(e, p), [event, payload] as const);

  await mcp("mcp-note", { id: "n1", quote: "行きます", source: "行きます", at: 6, comment: "Past tense: 昨日.", kind: "correction", suggestion: "行きました" });
  await mcp("mcp-note", { id: "n2", quote: "学校", source: "学校", at: 12, comment: "Nice.", kind: "note", suggestion: null });
  const panel = page.getByTestId("notes");
  await expect(panel.getByTestId("note")).toHaveCount(2);
  await expect(page.getByTestId("btn-notes")).toHaveText("メモ（2）");
  await expect.poll(() => page.evaluate(() => CSS.highlights.get("pico-note")?.size)).toBe(2);

  await panel.getByRole("button", { name: "適用" }).click();
  await expect.poll(() => markup(page)).toBe("昨日、学校に行きました。\n学校は楽しい。");
  await expect(panel.getByTestId("note")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => CSS.highlights.get("pico-note")?.size)).toBe(1);

  await mcp("mcp-replace", { source: "楽しい", at: 15, replacement: "とても楽しい" });
  await expect.poll(() => markup(page)).toBe("昨日、学校に行きました。\n学校はとても楽しい。");
  await mcp("mcp-remove-note", { id: "n2" });
  await expect(panel.getByTestId("note")).toHaveCount(0);
});

test("a correction on a word with a reading in the file replaces the reading too", async ({ page }) => {
  await setDoc(page, "今日《きょう》はたのしい。");
  const mcp = (event: string, payload: object) =>
    page.evaluate(([e, p]) => (window as unknown as { __picoMcp: (e: string, p: object) => void }).__picoMcp(e, p), [event, payload] as const);
  const panel = page.getByTestId("notes");
  await mcp("mcp-note", { id: "n3", quote: "今日は", source: "今日《きょう》は", at: 0, comment: "Try 明日.", kind: "correction", suggestion: "明日は" });
  await expect(panel.getByTestId("note")).toContainText("今日は → 明日は");
  await panel.getByRole("button", { name: "適用" }).click();
  await expect.poll(() => markup(page)).toBe("明日はたのしい。");
  await expect(panel.getByTestId("note")).toHaveCount(0);
});

test("the AI can insert text after a quote or at the end", async ({ page }) => {
  await setDoc(page, "昨日は学校に行きました。");
  const mcp = (event: string, payload: object) =>
    page.evaluate(([e, p]) => (window as unknown as { __picoMcp: (e: string, p: object) => void }).__picoMcp(e, p), [event, payload] as const);
  // The payloads Rust's insert_text sends (see mcp.rs tests).
  await mcp("mcp-replace", { source: "行きました。", at: 6, replacement: "行きました。楽しかった。" });
  await mcp("mcp-replace", { source: "", at: 18, replacement: "\n終わり" });
  await expect.poll(() => markup(page)).toBe("昨日は学校に行きました。楽しかった。\n終わり");
});

async function dropFile(page: Page, name: string, type: string, body: string) {
  await page.evaluate(
    ([name, type, body]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([body], name, { type }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    [name, type, body] as const,
  );
}

test("the PDF sits left of the page, resizes, and dropped files open", async ({ page }) => {
  await dropFile(page, "宿題.pdf", "application/pdf", "%PDF-1.4\n%%EOF\n");
  const pane = page.getByTestId("pdfpane");
  await expect(pane).toContainText("宿題.pdf");
  const paneBox = (await pane.boundingBox())!;
  const deskBox = (await page.locator(".desk").boundingBox())!;
  expect(paneBox.x).toBe(0);
  expect(paneBox.x + paneBox.width).toBeLessThan(deskBox.x);

  // The close button is centred in the title bar.
  const cap = (await pane.locator(".dict-cap").boundingBox())!;
  const close = (await page.getByRole("button", { name: "PDFを閉じる" }).boundingBox())!;
  expect(Math.abs(close.y + close.height / 2 - (cap.y + cap.height / 2))).toBeLessThan(1);

  const splitter = page.getByTestId("pdf-splitter");
  const s = (await splitter.boundingBox())!;
  await page.mouse.move(s.x + 3, s.y + 100);
  await page.mouse.down();
  await page.mouse.move(300, s.y + 100, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await pane.boundingBox())!.width).toBe(300);

  await dropFile(page, "作文.txt", "text/plain", "ドロップした作文");
  await expect.poll(() => markup(page)).toBe("ドロップした作文");
  await dropFile(page, "x.docx", "application/octet-stream", "x");
  await expect(page.getByTestId("status-message")).toContainText(".pdf");
});

test("Ctrl+A selects everything in the Jisho and translate boxes", async ({ page }) => {
  for (const [toggle, id] of [["dict", "dict-input"], ["translate", "translate-input"]] as const) {
    if (toggle === "translate") await page.getByTestId("btn-translate").click();
    const box = page.getByTestId(id);
    await box.fill("食べる 飲む");
    await box.press("End");
    await page.keyboard.press("Control+a");
    expect(await box.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 6]);
    await page.keyboard.press("Meta+a");
    expect(await box.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 6]);
  }
});

test("readings are never part of a selection @webkit", async ({ page }) => {
  const box = (await page.getByTestId("editor").boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 330, { steps: 8 });
  await page.mouse.up();
  const sel = await page.evaluate(() => getSelection()!.toString());
  expect(sel).toContain("昨日の日記");
  expect(sel).not.toContain("きのう");
});

test("arrow keys step one character across words with readings @webkit", async ({ page }) => {
  await stubReadings(page);
  await setDoc(page, "あ昨日は日い");
  const box = page.getByTestId("editor");
  await expect(box.locator('rt[data-r="きのう"]')).toBeVisible();
  await placeCaret(page, "あ", "start");
  const seen: string[] = [];
  for (let k = 0; k < 6; k++) {
    await page.keyboard.press("Shift+ArrowRight");
    seen.push(await page.evaluate(() => getSelection()!.toString()));
  }
  expect(seen).toEqual(["あ", "あ昨", "あ昨日", "あ昨日は", "あ昨日は日", "あ昨日は日い"]);
  for (let k = 0; k < 2; k++) await page.keyboard.press("Shift+ArrowLeft");
  expect(await page.evaluate(() => getSelection()!.toString())).toBe("あ昨日は");
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await page.evaluate(() => getSelection()!.toString())).toBe("あ昨日");

  await placeCaret(page, "あ", "start");
  for (let k = 0; k < 3; k++) await page.keyboard.press("ArrowRight");
  await page.keyboard.insertText("X");
  await expect.poll(() => markup(page)).toBe("あ昨日Xは日い");
});

test("a new or opened page puts the caret in the text, not the page corner @webkit", async ({ page }) => {
  const inLine = () =>
    page.evaluate(() => {
      const n = getSelection()!.anchorNode;
      return !!(n instanceof Element ? n : n?.parentElement)?.closest(".ln");
    });
  await page.getByTestId("btn-new").click();
  await expect.poll(inLine).toBe(true);
  await setDoc(page, "あ\nい");
  await expect.poll(inLine).toBe(true);
});

test("an unsaved untitled page comes back from the welcome screen", async ({ page }) => {
  await page.getByTestId("btn-new").click();
  await page.getByTestId("editor").click();
  await page.keyboard.insertText("下書きのテスト");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pico.draft"))).toBe("下書きのテスト");
  await page.reload();
  await page.getByTestId("open-draft").click();
  await expect.poll(() => markup(page)).toBe("下書きのテスト");
});

test("edits still count when a composition never ends", async ({ page }) => {
  await setDoc(page, "あ");
  await placeCaret(page, "あ");
  // Chromium can start a composition and never send compositionend (seen over a selection inside a ruby).
  await page.getByTestId("editor").evaluate((el) => el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" })));
  await page.keyboard.insertText("い");
  await expect.poll(() => markup(page)).toBe("あい");
});

test("deleting everything leaves one empty line to type in", async ({ page }) => {
  await page.getByTestId("btn-new").click();
  const box = page.getByTestId("editor");
  await box.click();
  await page.keyboard.insertText("あ");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(box.locator(":scope > .ln")).toHaveCount(1);
  await page.keyboard.insertText("い");
  await expect.poll(() => markup(page)).toBe("い");
});

test("every undo step changes something", async ({ page }) => {
  await page.getByTestId("btn-new").click();
  await page.getByTestId("editor").click();
  await page.keyboard.insertText("あ");
  await page.waitForTimeout(1100);
  await page.keyboard.insertText("い");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(1100);
  await page.keyboard.insertText("う");
  await expect.poll(() => markup(page)).toBe("あう");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => markup(page)).toBe("あ");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => markup(page)).toBe("");
});

test("side panes close with × and the side column resizes", async ({ page }) => {
  await page.getByTestId("btn-translate").click();
  await page.getByTestId("btn-notes").click();
  for (const id of ["dict", "translate", "notes"]) await expect(page.getByTestId(id)).toBeVisible();

  const side = page.locator(".side");
  const s = (await page.getByTestId("side-splitter").boundingBox())!;
  const vw = page.viewportSize()!.width;
  await page.mouse.move(s.x + 3, s.y + 100);
  await page.mouse.down();
  await page.mouse.move(vw - 420, s.y + 100, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(420);

  await page.getByRole("button", { name: "翻訳を閉じる" }).click();
  await expect(page.getByTestId("translate")).toHaveCount(0);
  await page.getByRole("button", { name: "辞書を閉じる" }).click();
  await page.getByRole("button", { name: "メモを閉じる" }).click();
  await expect(side).toHaveCount(0);
  await expect(page.getByTestId("side-splitter")).toHaveCount(0);
});

test("starts on a welcome screen with recent files and keyboard control", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("pico.recent", JSON.stringify(["/Users/me/Documents/日記.txt", "/Users/me/宿題.md"])));
  await page.reload();
  const welcome = page.getByTestId("welcome");
  await expect(page).toHaveTitle("pe-ji");
  await expect(page.getByTestId("editor")).toHaveCount(0);
  await expect(welcome).toContainText("日記.txt");
  await expect(welcome).toContainText("~/Documents/");

  // The newest recent file has focus; arrows move, Enter opens.
  await expect(welcome.getByRole("button", { name: /日記\.txt/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(welcome.getByRole("button", { name: /宿題\.md/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(welcome.getByRole("button", { name: "新しいページ" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("editor")).toBeFocused();
  await expect(page).toHaveTitle("無題.txt — pe-ji");

  // 1–9 open a recent file (the browser build cannot read paths, so it reports why).
  await page.reload();
  await expect(welcome.getByRole("button", { name: /日記\.txt/ })).toBeFocused();
  await page.keyboard.press("2");
  await expect(page.getByTestId("status-message")).toContainText("開けませんでした");
});
