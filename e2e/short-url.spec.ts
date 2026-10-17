import type { Page } from '@playwright/test'
import {
  clearEditor,
  closePage,
  expect,
  memoEditor,
  newLoggedInPage,
  openNoteChrome,
  test,
} from './helpers'
import { e2eNote, removeE2eNote, type E2eNote } from './notes'

// 短縮 URL (docs/111-短縮URL計画.md): 「番号」で番号タグを振る → 印刷 QR が
// /s/<番号> になる → /s/<番号> が 308 でノートへ → 同じ番号のノートが 2 件なら
// 検索へ。前の段が振った番号を次の段が使うので直列に流す。
//
// 番号はローカル DB の空き番号から振られるので、値は決め打ちせず印刷ページから読む。
// 後片付けで永久削除すれば番号は空きに戻る
const NOTE = e2eNote(111, `short ${Date.now()}`)
const TWIN = e2eNote(112, `twin ${Date.now()}`)

test.describe.configure({ mode: 'serial' })

async function createNote(page: Page, note: E2eNote, body: string): Promise<void> {
  await page.goto(`/edit/${note.id}`)
  const save = page.getByRole('button', { name: '更新', exact: true })
  await expect(save).toBeVisible()
  await clearEditor(page)
  await memoEditor(page).pressSequentially(body, { delay: 10 })
  await save.click()
  await expect(page).toHaveURL((url) => url.pathname === `/item/${note.id}`)
}

// 印刷ページの QR が載せている URL (img の alt は `QR: <URL>`)
async function printedUrl(page: Page, note: E2eNote): Promise<string> {
  await page.goto(`/print/${note.id}`)
  const alt = await page.getByRole('img', { name: /^QR: / }).getAttribute('alt')
  return (alt ?? '').replace(/^QR: /, '')
}

let assigned = ''

test.describe('短縮 URL', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await removeE2eNote(page, TWIN)
    await closePage(page)
  })

  test.afterAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await removeE2eNote(page, TWIN)
    await closePage(page)
  })

  test('番号の無いノートの印刷 QR は id の URL', async ({ page }) => {
    // Arrange
    await createNote(page, NOTE, NOTE.heading)

    // Act
    const url = await printedUrl(page, NOTE)

    // Assert
    expect(url).toMatch(new RegExp(`/item/${NOTE.id}$`))
  })

  test('「番号」を押すと番号タグが付き、印刷 QR が /s/<番号> になる', async ({ page }) => {
    // Arrange
    await page.goto(`/item/${NOTE.id}`)
    await openNoteChrome(page)
    const assign = page.getByRole('button', { name: '番号', exact: true })

    // Act
    await assign.click()

    // Assert
    await expect(page.getByRole('button', { name: '番号', exact: true })).toHaveCount(0)
    const url = await printedUrl(page, NOTE)
    const match = /\/s\/([1-9][0-9]{3})$/.exec(url)
    expect(match).not.toBeNull()
    assigned = match![1]
    // QR の下には番号を大きく出す
    await expect(page.getByText(`#${assigned}`, { exact: true })).toBeVisible()
  })

  test('/s/<番号> は 308 でノートへ転送される', async ({ page }) => {
    test.skip(assigned === '', '前の段で番号が振れていない')

    // Act
    const res = await page.request.get(`/s/${assigned}`, { maxRedirects: 0 })

    // Assert
    expect(res.status()).toBe(308)
    // Location は相対のことがある (proxy は request の URL を起点に組む)
    expect(new URL(res.headers().location, 'http://localhost').pathname).toBe(`/item/${NOTE.id}`)
    await page.goto(`/s/${assigned}`)
    await expect(page).toHaveURL((url) => url.pathname === `/item/${NOTE.id}`)
  })

  test('同じ番号のノートが 2 件なら検索へ送る', async ({ page }) => {
    test.skip(assigned === '', '前の段で番号が振れていない')

    // Arrange
    await createNote(page, TWIN, `${TWIN.heading}\n#${assigned}`)

    // Act
    const res = await page.request.get(`/s/${assigned}`, { maxRedirects: 0 })

    // Assert
    expect(res.status()).toBe(307)
    const location = new URL(res.headers().location, 'http://localhost')
    expect(location.pathname).toBe('/')
    // 全文検索ではなくタグ検索 (docs/111 §7)
    expect(location.searchParams.get('q')).toBe(`#${assigned}`)
  })

  test('未ログインの /s/<番号> は同じ URL のままログイン画面 (検索へ送らない)', async ({ browser }) => {
    test.skip(assigned === '', '前の段で番号が振れていない')

    // Arrange: cookie を持たない文脈
    const context = await browser.newContext({ storageState: undefined })

    // Act
    const res = await context.request.get(`/s/${assigned}`, { maxRedirects: 0 })

    // Assert
    expect(res.status()).toBe(200)
    expect(await res.text()).toContain('ログイン')
    await context.close()
  })
})
