import type { Locator, Page } from '@playwright/test'
import {
  clearEditor,
  closePage,
  expect,
  memoEditor,
  newLoggedInPage,
  newTouchPage,
  searchBox,
  test,
  selectNoteTab,
} from './helpers'
import { e2eNote, removeE2eNote } from './notes'

// 長押しで出る OS のメニュー (docs/98-長押しメニュー抑止計画.md)。
// 指で触る画面では文字の選択と iOS の吹き出しを画面全体で止め、ノートの
// タブ (markdown / テキスト / 編集) の中と、文字を打つ欄だけ戻す。
//
// -webkit-touch-callout は Chromium が解さないので、ここで見られるのは文字選択の
// 側だけ。吹き出し (リンクのプレビュー・画像のメニュー) は iPhone 実機で見る
const NOTE = e2eNote(5, `callout ${Date.now()}`)
const ITEM_ID = NOTE.id
const BODY = NOTE.heading

// 選べる文字が残っているか。user-select は継承しない (子の計算値は auto の
// まま) ので、計算値ではなく実際に選ばせて確かめる
async function selectedText(locator: Locator): Promise<string> {
  return locator.evaluate((el) => {
    const selection = window.getSelection()
    if (selection === null) {
      throw new Error('getSelection が null')
    }
    selection.selectAllChildren(el)
    const text = selection.toString()
    selection.removeAllRanges()
    return text
  })
}

function userSelectOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).userSelect)
}

function selectModeButton(page: Page): Locator {
  return page.getByRole('button', { name: '選択', exact: true })
}

test.describe('長押しで OS のメニューを出さない', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await page.goto(`/edit/${ITEM_ID}`)
    const save = page.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(page)
    await memoEditor(page).pressSequentially(BODY, { delay: 10 })
    await save.click()
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_ID}`)
    await closePage(page)
  })

  test.afterAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await closePage(page)
  })

  test('指の画面では、検索結果の操作の文字を選ばせない', async ({ browser }) => {
    // Arrange
    const page = await newTouchPage(browser)
    await page.goto('/')
    await expect(selectModeButton(page)).toBeVisible()

    // Act
    const text = await selectedText(selectModeButton(page))

    // Assert
    expect(text).toBe('')
    await closePage(page)
  })

  // 欄はタブの外でも戻す。選べないと長押しのペーストもカーソル移動のルーペも出ない
  test('指の画面でも、検索窓は選べる', async ({ browser }) => {
    // Arrange
    const page = await newTouchPage(browser)

    // Act
    await page.goto('/')
    await expect(searchBox(page)).toBeVisible()

    // Assert
    expect(await userSelectOf(searchBox(page))).toBe('text')
    await closePage(page)
  })

  test('指の画面でも、ノートの 3 つのタブの中は選べる', async ({ browser }) => {
    // Arrange
    const page = await newTouchPage(browser)
    await page.goto(`/item/${ITEM_ID}`)

    // Act / Assert: 本文があるので markdown タブで開く
    const rendered = page.getByText(BODY).first()
    await expect(rendered).toBeVisible()
    expect(await selectedText(rendered)).toBe(BODY)

    await selectNoteTab(page, 'テキスト')
    const plain = page.getByText(BODY).locator('visible=true').first()
    await expect(plain).toBeVisible()
    expect(await selectedText(plain)).toContain(BODY)

    await selectNoteTab(page, '編集')
    await expect(memoEditor(page)).toBeVisible()
    expect(await selectedText(memoEditor(page))).toContain(BODY)

    // タブの見出しは押す物。戻すのは中身だけ
    expect(await selectedText(page.getByRole('tablist'))).toBe('')
    await closePage(page)
  })

  // PC のマウスは長押しに化けない。一覧のタイトルや本文を選んでコピーする手を残す
  test('PC では文字を選べる', async ({ page }) => {
    // Arrange
    await page.goto('/')
    await expect(selectModeButton(page)).toBeVisible()

    // Act
    const text = await selectedText(selectModeButton(page))

    // Assert
    expect(text).toBe('選択')
  })
})
