import type { Page } from '@playwright/test'
import { BASE_URL } from './env'
import { closePage, expect, newLoggedInPage, test } from './helpers'

// メニューの「サーバへコピー」「サーバからペースト」
// (docs/114-サーバクリップボード計画.md §5 Phase 5)。
//
// OS のクリップボードを実際に書いて読む (chromium に clipboard-read / write を許す)。
// Windows の Chrome と同じ経路なので、文字と画像の往復と「消す」を通す。
// iOS の「ペースト」の吹き出しは再現できないので、iPhone 実機で確かめる
//
// 枠は利用者ごとに 1 行。E2E の利用者 (e2e) の行しか触らないので、本物のデータには
// 届かない。前の回の中身が残らないよう、前後で DELETE する

const TEXT = 'サーバクリップボードの E2E: 日本語 abc 😀'

async function openMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'メニュー', exact: true }).click()
  await expect(page.getByRole('button', { name: 'サーバへコピー' })).toBeVisible()
}

// 知らせは span。同じ role の他の要素 (引っ張って更新の案内・ルート読み上げ) と区別する
const statusNote = (page: Page) => page.locator('span[role="status"]')
const alertNote = (page: Page) => page.locator('span[role="alert"]')

async function clearSlotViaApi(page: Page): Promise<void> {
  const res = await page.request.delete('/api/clipboard')
  expect(res.ok()).toBe(true)
}

// 画像をクリップボードに載せる。canvas で描いた 8x8 の PNG
async function writeImageToClipboard(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const context = canvas.getContext('2d')
    if (context === null) {
      throw new Error('canvas 2d が取れません')
    }
    context.fillStyle = '#d33'
    context.fillRect(0, 0, 8, 8)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob')), 'image/png')),
    )
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  })
}

test.describe('サーバ経由のクリップボード', () => {
  let page: Page

  test.beforeEach(async ({ browser }) => {
    page = await newLoggedInPage(browser)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL })
    await page.goto('/')
    await clearSlotViaApi(page)
  })

  test.afterEach(async () => {
    await clearSlotViaApi(page)
    await closePage(page)
  })

  test('中身が無いときはペーストが押せず「なし」と出る', async () => {
    await openMenu(page)

    await expect(page.getByRole('button', { name: /サーバからペースト/ })).toBeDisabled()
    await expect(page.getByText('なし', { exact: true })).toBeVisible()
  })

  test('文字: 送って、別の文字で上書きした OS のクリップボードへ受け取れる', async () => {
    // Arrange
    await page.evaluate((text) => navigator.clipboard.writeText(text), TEXT)
    await openMenu(page)

    // Act: 送る
    await page.getByRole('button', { name: 'サーバへコピー' }).click()

    // Assert: 知らせと、ペースト行の予告
    await expect(statusNote(page)).toContainText('サーバへ送りました (文字 ')
    await expect(page.getByRole('button', { name: /サーバからペースト/ })).toContainText('いま')

    // Act: OS のクリップボードを別の物にしてから受け取る
    await page.evaluate(() => navigator.clipboard.writeText('別の文字'))
    await page.getByRole('button', { name: /サーバからペースト/ }).click()

    // Assert
    await expect(statusNote(page)).toContainText('クリップボードにコピーしました')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(TEXT)
  })

  test('画像: 送って、受け取ると image/png でクリップボードに載る', async () => {
    // Arrange
    await writeImageToClipboard(page)
    await openMenu(page)

    // Act
    await page.getByRole('button', { name: 'サーバへコピー' }).click()

    // Assert: サーバの枠に画像が入った
    await expect(statusNote(page)).toContainText('サーバへ送りました (画像 ')
    const stored = await page.request.get('/api/clipboard/data')
    expect(stored.status()).toBe(200)
    expect(stored.headers()['content-type']).toBe('image/png')
    expect(stored.headers()['cache-control']).toBe('no-store')

    // Act: 文字で上書きしてから受け取る
    await page.evaluate(() => navigator.clipboard.writeText('x'))
    await page.getByRole('button', { name: /サーバからペースト/ }).click()

    // Assert
    await expect(statusNote(page)).toContainText('クリップボードにコピーしました')
    const types = await page.evaluate(async () => {
      const items = await navigator.clipboard.read()
      return items.flatMap((item) => [...item.types])
    })
    expect(types).toContain('image/png')
  })

  test('「消す」で枠が空になり、ペーストが押せなくなる', async () => {
    await page.evaluate((text) => navigator.clipboard.writeText(text), TEXT)
    await openMenu(page)
    await page.getByRole('button', { name: 'サーバへコピー' }).click()
    await expect(statusNote(page)).toContainText('サーバへ送りました')

    await page.getByRole('button', { name: '消す', exact: true }).click()

    await expect(statusNote(page)).toContainText('消しました')
    await expect(page.getByRole('button', { name: /サーバからペースト/ })).toBeDisabled()
    const res = await page.request.get('/api/clipboard')
    expect((await res.json()).data.slot).toBeNull()
  })

  test('メニューを開き直すと、サーバの中身を読み直して予告を出す', async () => {
    await page.evaluate((text) => navigator.clipboard.writeText(text), TEXT)
    await openMenu(page)
    await page.getByRole('button', { name: 'サーバへコピー' }).click()
    await expect(statusNote(page)).toContainText('サーバへ送りました')

    await page.keyboard.press('Escape')
    await page.reload()
    await openMenu(page)

    await expect(page.getByRole('button', { name: /サーバからペースト/ })).toContainText('文字 ')
    await expect(page.getByRole('button', { name: /サーバからペースト/ })).toBeEnabled()
  })

  test('クリップボードに文字も画像も無いときは理由を出し、サーバは変わらない', async () => {
    // 空文字は text/plain として載らない環境があるので、空の ClipboardItem を直接作れない。
    // 代わりに「空の文字」を載せて断られることを見る
    await page.evaluate(() => navigator.clipboard.writeText(''))
    await openMenu(page)

    await page.getByRole('button', { name: 'サーバへコピー' }).click()

    await expect(alertNote(page)).toContainText(/クリップボード/)
    const res = await page.request.get('/api/clipboard')
    expect((await res.json()).data.slot).toBeNull()
  })
})
