import type { Page } from '@playwright/test'
import { BASE_URL } from './env'
import { closePage, expect, expectHydrated, newLoggedInPage, test } from './helpers'
import { solidPng } from './imageBytes'
import { e2eNote, openSearch, putE2eNote, removeE2eNote, searchResults } from './notes'

// 一覧が画面に収まったら、スクロールを待たずに続きを読み込む (docs/118 §2-6)。
//
// 一覧が器より長い間は「下へスクロールするまで続きを読まない」(§2)。そのあと
// 表示モードの切替・ウィンドウの拡大で一覧が器に収まっても、測り直さずに
// 止まったままで、「さらに表示」を押すしかなかった。
//
// 1 ページは 20 件 (lib/items/limits.ts の PAGE_SIZE) なので 21 件作る。
// 続きを読み切ると「さらに表示」の目印 ([data-auto-load-more]) が消える
const TOKEN = `zzfill${Date.now()}`
const COUNT = 21
const NOTES = Array.from({ length: COUNT }, (_, i) => e2eNote(300 + i, TOKEN))
const IMAGES_PATH = '/api/images'
const imageOf = (i: number) => `00000000-0000-4000-8000-${String(300 + i).padStart(12, '0')}.png`
// ノート 21 件の作成・片付けの上限
const HOOK_TIMEOUT_MS = 600_000
// 「止まっている」と見なすまで待つ時間。自動の読み込みは描画の次のフレームで走る
const SETTLE_MS = 1_500

async function serveImages(page: Page): Promise<void> {
  const png = solidPng(64, 64, [40, 120, 200])
  await page.context().route(
    (url) => url.pathname.startsWith(`${IMAGES_PATH}/00000000-0000-4000-8000-000000000`),
    (route) => route.fulfill({ contentType: 'image/png', body: png }),
  )
}

async function setPrefs(page: Page, view: string, panes: string): Promise<void> {
  await page.context().addCookies([
    { name: 'view', value: view, url: BASE_URL },
    { name: 'panes', value: panes, url: BASE_URL },
  ])
}

test.describe('一覧が画面に収まったら続きを自動で読む', () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(HOOK_TIMEOUT_MS)
    const page = await newLoggedInPage(browser)
    for (const [i, note] of NOTES.entries()) {
      await putE2eNote(page, note, `${note.heading}\n![](${IMAGES_PATH}/${imageOf(i)})\n`)
    }
    await closePage(page)
  })

  test.afterAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(HOOK_TIMEOUT_MS)
    const page = await newLoggedInPage(browser)
    for (const note of NOTES) {
      await removeE2eNote(page, note)
    }
    await closePage(page)
  })

  test('大から画像へ切り替えて一覧が収まると、押さずに続きが届く (1 ペイン)', async ({ page }) => {
    // Arrange: 大の表示では 20 件が画面より長い
    await page.setViewportSize({ width: 1280, height: 1000 })
    await serveImages(page)
    await setPrefs(page, 'card', '1')
    const results = await openSearch(page, TOKEN)
    const loadMore = page.locator('[data-auto-load-more]')
    await expect(loadMore).toBeAttached()
    await page.waitForTimeout(SETTLE_MS)
    await expect(loadMore).toBeAttached()
    const toggle = results.getByRole('button', { name: /^表示: 大/ })
    await expectHydrated(toggle)

    // Act: 短く押すと 大 → 画像
    await toggle.click()

    // Assert: 画像表示の 20 件は画面に収まり、スクロールせずに 21 件目が届く
    await expect(results.getByRole('button', { name: /^表示: 画像/ })).toBeVisible()
    await expect(loadMore).toHaveCount(0)
    await expect(searchResults(page).getByRole('button', { name: '画像を大きく表示' })).toHaveCount(
      COUNT,
    )
  })

  test('幅の境をまたいで送る側が替わっても、一覧が長いままなら読まない (1 ペイン)', async ({
    page,
  }) => {
    // Arrange: 狭い画面は文書ごと送り、広い画面は一覧の器が送る (globals.css)
    await page.setViewportSize({ width: 900, height: 500 })
    await serveImages(page)
    await setPrefs(page, 'image', '1')
    await openSearch(page, TOKEN)
    const loadMore = page.locator('[data-auto-load-more]')
    await expect(loadMore).toBeAttached()

    // Act
    await page.setViewportSize({ width: 1280, height: 500 })
    await page.waitForTimeout(SETTLE_MS)

    // Assert: 送る側を取り違えて「収まっている」と測ると、ここで読んでしまう
    await expect(loadMore).toBeAttached()
    await expect(loadMore).toContainText('残り 1 件')
  })

  test('ウィンドウを縦に広げて一覧が収まると、押さずに続きが届く (3 ペイン)', async ({ page }) => {
    // Arrange: 低い画面では一覧の器 (内側でスクロールする) より長い
    await page.setViewportSize({ width: 1280, height: 500 })
    await serveImages(page)
    await setPrefs(page, 'image', '3')
    await openSearch(page, TOKEN)
    const loadMore = page.locator('[data-auto-load-more]')
    await expect(loadMore).toBeAttached()
    await page.waitForTimeout(SETTLE_MS)
    await expect(loadMore).toBeAttached()

    // Act
    await page.setViewportSize({ width: 1280, height: 2400 })

    // Assert
    await expect(loadMore).toHaveCount(0)
  })

  test('続きの枠を先に並べ、枠が画面に入ったら中身が届く (docs/129 §1)', async ({ page }) => {
    // Arrange: 小の表示で 20 件が画面より長い (1 ペイン・文書ごと送る)
    await page.setViewportSize({ width: 900, height: 500 })
    await setPrefs(page, 'compact', '1')
    const results = await openSearch(page, TOKEN)
    const frames = page.locator('[data-placeholder-page]')
    await expect(frames).toHaveCount(1)
    await expect(frames.locator('li')).toHaveCount(COUNT - 20)

    // Act: 枠まで送る
    await frames.scrollIntoViewIfNeeded()

    // Assert: 枠が本物の行に置き換わり、続きの目印も消える
    await expect(page.locator('[data-auto-load-more]')).toHaveCount(0)
    await expect(frames).toHaveCount(0)
    await expect(
      results.getByRole('listitem').filter({ has: page.locator('a[href^="/item/"]') }),
    ).toHaveCount(COUNT)
  })
})
