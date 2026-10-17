import type { Page } from '@playwright/test'
import { BASE_URL, E2E_ITEM_PREFIX } from './env'
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

// 検索結果の行の ⋮ メニュー (docs/107-行メニュー計画.md)。
// PC でもスマホでも、行の右端に常に居る ⋮ から全部の操作を辿れること。
const ITEM_NO = `${E2E_ITEM_PREFIX}7`
const BODY = `${E2E_ITEM_PREFIX} row menu ${Date.now()}`

async function openRow(page: Page) {
  await page.goto(`/?q=${encodeURIComponent(ITEM_NO)}`)
  const results = searchResults(page)
  // 結果は Suspense の中。文字が読めても行が hidden の器に居る間がある
  // (notes.ts の trashFromSearch と同じ待ち方)
  await expect(results.getByText(`「${ITEM_NO}」の検索結果`)).toBeVisible()
  const row = rowOf(page, results, ITEM_NO)
  const trigger = row.getByRole('button', { name: `#${ITEM_NO} の操作`, exact: true })
  await expectHydrated(trigger)
  return { row, trigger }
}

function rowMenu(page: Page) {
  return page.getByRole('menu', { name: `#${ITEM_NO} の操作`, exact: true })
}

test.describe('検索結果の行の ⋮ メニュー', () => {
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

  test('PC: ⋮ で文字付きのメニューが開き、先頭の項目にフォーカスが移る', async ({ page }) => {
    // Arrange
    const { trigger } = await openRow(page)

    // Act
    await trigger.click()

    // Assert
    const item = rowMenu(page).getByRole('menuitem', { name: 'ゴミ箱へ移動', exact: true })
    await expect(item).toBeVisible()
    await expect(item).toHaveText('ゴミ箱へ移動')
    await expect(item).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  test('PC: Esc で閉じ、フォーカスは ⋮ へ戻る', async ({ page }) => {
    // Arrange
    const { trigger } = await openRow(page)
    await trigger.click()
    await expect(rowMenu(page)).toBeVisible()

    // Act
    await page.keyboard.press('Escape')

    // Assert
    await expect(rowMenu(page)).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test('PC: Tab で閉じ、フォーカスは ⋮ の次へ進む', async ({ page }) => {
    // Arrange: メニュー無しで ⋮ から Tab したときの行き先に印を付けておく。
    // 行き先は一覧の件数や画面の部品で変わるので、決め打ちせず比べる。
    // 開くのは全件の一覧 — 1 件だけの検索結果では ⋮ の次に部品が無く、
    // 素の Tab でもページの外 (ブラウザの枠) へ出てしまい比べられない。
    // 保存したばかりの ITEM_NO が更新順の先頭に居て、次の行が後ろに続く
    await page.goto('/')
    const trigger = page.getByRole('button', { name: `#${ITEM_NO} の操作`, exact: true })
    await expectHydrated(trigger)
    await trigger.focus()
    await page.keyboard.press('Tab')
    await page.evaluate(() => document.activeElement?.setAttribute('data-e2e-next', ''))
    await trigger.click()
    await expect(rowMenu(page)).toBeVisible()

    // Act
    await page.keyboard.press('Tab')

    // Assert: ⋮ に留まらず (行ごとに Tab が 1 回余計に要る)、body にも落ちない
    await expect(rowMenu(page)).toHaveCount(0)
    await expect(page.locator('[data-e2e-next]')).toBeFocused()
  })

  test('PC: ⋮ をもう一度押すと閉じる', async ({ page }) => {
    // Arrange
    const { trigger } = await openRow(page)
    await trigger.click()
    await expect(rowMenu(page)).toBeVisible()

    // Act
    await trigger.click()

    // Assert
    await expect(rowMenu(page)).toHaveCount(0)
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  test('PC: ⋮ を押してもノートは開かない', async ({ page }) => {
    // Arrange
    const { trigger } = await openRow(page)
    const before = new URL(page.url()).pathname

    // Act
    await trigger.click()

    // Assert: 行の当たり判定 (stretched link) に押下を渡していない
    await expect(rowMenu(page)).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(before)
  })

  test('スマホ: ホバーなしで ⋮ が見え、メニューからゴミ箱へ入れられる', async ({ browser }) => {
    // Arrange
    const page = await newTouchPage(browser)
    const { row, trigger } = await openRow(page)
    await expect(trigger).toBeVisible()

    // Act
    await trigger.tap()
    await rowMenu(page).getByRole('menuitem', { name: 'ゴミ箱へ移動', exact: true }).tap()

    // Assert
    await expect(row).toHaveCount(0)
    await closePage(page)
  })
})

// 画像モードのタイルの ⋮ (docs/107 §7)。タイルは画像 1 枚ごとなので、
// ゴミ箱へ入れる前に「ノートごと・他のタイルもまとめて消える」と確認する
const TILE_ITEM_NO = `${E2E_ITEM_PREFIX}8`
// 画像の実体は要らない (タイルは本文の参照から組まれる。読み込めない画像は
// 地色の正方形で出るだけ)。uuid の形でないと画像として拾われない
const TILE_BODY = [
  `${E2E_ITEM_PREFIX} tile menu ${Date.now()}`,
  '![](/api/images/00000000-0000-4000-8000-0000000000a1.png)',
  '![](/api/images/00000000-0000-4000-8000-0000000000a2.png)',
  '',
].join('\n')

async function openImageMode(page: Page) {
  await page.context().addCookies([{ name: 'view', value: 'image', url: BASE_URL }])
  await page.goto(`/?q=${encodeURIComponent(TILE_ITEM_NO)}`)
  // 結果は Suspense の中で、hidden の器に居る間は数えても押せない (openRow と同じ)
  await expect(
    searchResults(page).getByText(`「${TILE_ITEM_NO}」の検索結果`),
  ).toBeVisible()
  const triggers = searchResults(page).getByRole('button', {
    name: `#${TILE_ITEM_NO} の操作`,
    exact: true,
  })
  await expect(triggers).toHaveCount(2)
  await expectHydrated(triggers.first())
  return triggers
}

test.describe('画像モードのタイルの ⋮ メニュー', () => {
  test.beforeEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, TILE_ITEM_NO)
    await page.goto(`/edit/${TILE_ITEM_NO}`)
    const save = page.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(page)
    await memoEditor(page).click()
    // insertText は 1 回の入力なので、![ の括弧の自動補完が挟まらない
    await page.keyboard.insertText(TILE_BODY)
    await save.click()
    await expect(page).toHaveURL((url) => url.pathname === `/item/${TILE_ITEM_NO}`)
    await closePage(page)
  })

  test.afterEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, TILE_ITEM_NO)
    await closePage(page)
  })

  test('確認で取り消すと、タイルは残る', async ({ page }) => {
    // Arrange
    const triggers = await openImageMode(page)
    let message = ''
    page.once('dialog', (dialog) => {
      message = dialog.message()
      void dialog.dismiss()
    })

    // Act
    await triggers.first().click()
    await page.getByRole('menuitem', { name: 'ゴミ箱へ移動', exact: true }).click()

    // Assert: 確認文はノートごと・2 枚まとめて消えることを言う
    expect(message).toContain(`#${TILE_ITEM_NO} をノートごとゴミ箱へ移動します`)
    expect(message).toContain('2 枚')
    // 取り消しが効かずに送っていても、一覧から消えるのは revalidate の後。
    // 直後に数えるだけでは検証にならないので、読み直してから数える
    await page.waitForTimeout(1000)
    await page.reload()
    await expect(triggers).toHaveCount(2)
  })

  test('確認で OK すると、同じノートのタイルがまとめて消える', async ({ page }) => {
    // Arrange
    const triggers = await openImageMode(page)
    page.once('dialog', (dialog) => void dialog.accept())

    // Act: 2 枚目の ⋮ から入れても、ノートごと入る
    await triggers.nth(1).click()
    await page.getByRole('menuitem', { name: 'ゴミ箱へ移動', exact: true }).click()

    // Assert
    await expect(triggers).toHaveCount(0)
  })
})
