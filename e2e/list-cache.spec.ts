import { closePage, expect, newLoggedInPage, test } from './helpers'
import { e2eNote, openSearch, putE2eNote, removeE2eNote } from './notes'

// 検索一覧の控えを端末に残し、再読み込みの後は 304 で確かめる (docs/129 §2・§3)。
//
// 一覧の控えはメモリにしか無く、再読み込みのたびに本文ごと取り直していた。
// IndexedDB に残した控えの ETag を添えて取りに行き、変わっていなければ
// サーバは 304 で本文を返さない
const TOKEN = `zzcache${Date.now()}`
const NOTE = e2eNote(400, TOKEN)
// 控えを書くまでの待ち (listPersist.ts の SAVE_DELAY_MS) より長く
const SAVE_WAIT_MS = 2_500

test.describe('検索一覧の控え', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await putE2eNote(page, NOTE, `${NOTE.heading}\n`)
    await closePage(page)
  })

  test.afterAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await closePage(page)
  })

  test('再読み込みの後は残した控えの ETag を添え、変わっていなければ 304', async ({ page }) => {
    // Arrange: 1 回目は本文を受け、控えを書くまで待つ
    const results = await openSearch(page, TOKEN)
    await expect(results.getByText(NOTE.heading).first()).toBeVisible()
    await page.waitForTimeout(SAVE_WAIT_MS)

    // Act
    const reply = page.waitForResponse(
      (res) => res.url().includes('/api/items?') && res.url().includes(encodeURIComponent(TOKEN)),
    )
    await page.reload()

    // Assert
    const res = await reply
    expect(res.request().headers()['if-none-match']).toBeTruthy()
    expect(res.status()).toBe(304)
    await expect(results.getByText(NOTE.heading).first()).toBeVisible()
  })
})
