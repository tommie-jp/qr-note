import type { Page } from '@playwright/test'
import { E2E_ITEM_PREFIX } from './env'
import {
  clearEditor,
  closePage,
  expect,
  expectHydrated,
  memoEditor,
  newLoggedInPage,
  newTouchPage,
  test,
} from './helpers'
import { removeE2eNote, rowOf, searchResults } from './notes'

// 行の ⋯ の出し方 (ui.ts の ROW_MENU_TRIGGER_CLASS)。
// PC (hover がある) ではホバー中の行にだけ出し、キーボードで入ったときと
// メニューを開いている間は出したままにする。タッチ端末では常に出す。
// 透明にするだけなので、見えているかは opacity で見る (toBeVisible は
// opacity 0 でも真になる)
const ITEM_NO = `${E2E_ITEM_PREFIX}11`
const BODY = `${E2E_ITEM_PREFIX} row menu hover ${Date.now()}`

async function openRow(page: Page) {
  await page.goto(`/?q=${encodeURIComponent(ITEM_NO)}`)
  const results = searchResults(page)
  // 結果は Suspense の中。文字が読めても行が hidden の器に居る間がある
  await expect(results.getByText(`「${ITEM_NO}」の検索結果`)).toBeVisible()
  const row = rowOf(page, results, ITEM_NO)
  const trigger = row.getByRole('button', { name: `#${ITEM_NO} の操作`, exact: true })
  await expectHydrated(trigger)
  return { row, trigger }
}

// 行から外れた所 (画面の左上の角) へポインタを逃がす
async function moveAway(page: Page) {
  await page.mouse.move(0, 0)
}

test.describe('行の ⋯ はPC ではホバー中だけ出す', () => {
  test.beforeEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, ITEM_NO)
    await page.goto(`/edit/${ITEM_NO}`)
    const save = page.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(page)
    await memoEditor(page).pressSequentially(BODY, { delay: 10 })
    await save.click()
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_NO}`)
    await closePage(page)
  })

  test.afterEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, ITEM_NO)
    await closePage(page)
  })

  test('PC: ホバーしていない行では ⋯ を隠し、ホバーすると出す', async ({ page }) => {
    // Arrange
    const { row, trigger } = await openRow(page)
    await moveAway(page)
    await expect(trigger).toHaveCSS('opacity', '0')

    // Act
    await row.hover()

    // Assert
    await expect(trigger).toHaveCSS('opacity', '1')
    await moveAway(page)
    await expect(trigger).toHaveCSS('opacity', '0')
  })

  test('PC: メニューを開いている間は、ポインタが離れても ⋯ を出したままにする', async ({
    page,
  }) => {
    // Arrange
    const { trigger } = await openRow(page)
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')

    // Act
    await moveAway(page)

    // Assert
    await expect(trigger).toHaveCSS('opacity', '1')
  })

  test('PC: Esc でメニューを閉じてフォーカスが戻った ⋯ は、ポインタが離れても出したままにする', async ({
    page,
  }) => {
    // Arrange
    const { trigger } = await openRow(page)
    await trigger.click()
    await moveAway(page)

    // Act
    await page.keyboard.press('Escape')

    // Assert
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toHaveCSS('opacity', '1')
  })

  test('スマホ: ホバーが無いので ⋯ を最初から出す', async ({ browser }) => {
    // Arrange
    const page = await newTouchPage(browser)

    // Act
    const { trigger } = await openRow(page)

    // Assert
    await expect(trigger).toHaveCSS('opacity', '1')
    await closePage(page)
  })
})
