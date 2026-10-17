import type { Browser, Page } from '@playwright/test'
import { BASE_URL } from './env'
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
import {
  type E2eNote,
  e2eNote,
  noteName,
  openSearch,
  removeE2eNote,
  rowOf,
  searchResults,
} from './notes'

// 検索結果の行の ⋮ メニュー (docs/107-行メニュー計画.md)。
// PC でもスマホでも、行の右端に常に居る ⋮ から全部の操作を辿れること。
const NOTE = e2eNote(7, `row menu ${Date.now()}`)
// Tab の行き先を比べるテストで、NOTE の 1 つ上に置くもう 1 件 (下の test を見よ)
const UPPER_NOTE = e2eNote(9, `row menu upper ${Date.now()}`)

// 本文を書いて保存する (無ければ作る)。途中で落ちた回の残りは先に消す
async function saveNote(browser: Browser, note: E2eNote) {
  const page = await newLoggedInPage(browser)
  await removeE2eNote(page, note)
  await page.goto(`/edit/${note.id}`)
  const save = page.getByRole('button', { name: '更新', exact: true })
  await expect(save).toBeVisible()
  await clearEditor(page)
  await memoEditor(page).pressSequentially(note.heading, { delay: 10 })
  await save.click()
  await expect(page).toHaveURL((url) => url.pathname === `/item/${note.id}`)
  await closePage(page)
}

async function openRow(page: Page) {
  // 結果は Suspense の中。文字が読めても行が hidden の器に居る間がある
  // (openSearch が見えるまで待つ)
  const results = await openSearch(page, NOTE.key)
  const row = rowOf(page, results, NOTE.id)
  const trigger = row.getByRole('button', { name: `${noteName(NOTE)}の操作`, exact: true })
  await expectHydrated(trigger)
  return { row, trigger }
}

function rowMenu(page: Page, note: E2eNote = NOTE) {
  return page.getByRole('menu', { name: `${noteName(note)}の操作`, exact: true })
}

test.describe('検索結果の行の ⋮ メニュー', () => {
  test.beforeEach(async ({ browser }) => {
    await saveNote(browser, NOTE)
  })

  test.afterEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await removeE2eNote(page, UPPER_NOTE)
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

  test('PC: Tab で閉じ、フォーカスは ⋮ の次へ進む', async ({ page, browser }) => {
    // Arrange: メニュー無しで ⋮ から Tab したときの行き先に印を付けておく。
    // 行き先は一覧の件数や画面の部品で変わるので、決め打ちせず比べる。
    //
    // 比べるには ⋮ の次に部品が要る。専用 DB (CI もこれ) には NOTE しか
    // 無く、1 行だけの一覧では ⋮ がページ最後のフォーカス要素で、素の Tab でも
    // ページの外 (ブラウザの枠) へ出てしまう。外へ出ると document.hasFocus()
    // が偽になり、Playwright の toBeFocused は body にすら通らない。そこで
    // もう 1 件作って行を 2 つにする。一覧は更新順 (新しい順) なので、後から
    // 保存した UPPER_NOTE が先頭、NOTE がその次の行になる。Tab するのは
    // 先頭 (UPPER_NOTE) の ⋮
    await saveNote(browser, UPPER_NOTE)
    await page.goto('/')
    const trigger = page.getByRole('button', {
      name: `${noteName(UPPER_NOTE)}の操作`,
      exact: true,
    })
    await expectHydrated(trigger)
    await trigger.focus()
    await page.keyboard.press('Tab')
    await page.evaluate(() => document.activeElement?.setAttribute('data-e2e-next', ''))
    // 印が body に付いたら、⋮ の次に部品が無い (上の前提が崩れている)
    await expect(page.locator('body[data-e2e-next]')).toHaveCount(0)
    await trigger.click()
    await expect(rowMenu(page, UPPER_NOTE)).toBeVisible()

    // Act
    await page.keyboard.press('Tab')

    // Assert: ⋮ に留まらず (行ごとに Tab が 1 回余計に要る)、body にも落ちない
    await expect(rowMenu(page, UPPER_NOTE)).toHaveCount(0)
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
const TILE_NOTE = e2eNote(8, `tile menu ${Date.now()}`)
// 画像の実体は要らない (タイルは本文の参照から組まれる。読み込めない画像は
// 地色の正方形で出るだけ)。uuid の形でないと画像として拾われない
const TILE_BODY = [
  TILE_NOTE.heading,
  '![](/api/images/00000000-0000-4000-8000-0000000000a1.png)',
  '![](/api/images/00000000-0000-4000-8000-0000000000a2.png)',
  '',
].join('\n')

async function openImageMode(page: Page) {
  await page.context().addCookies([{ name: 'view', value: 'image', url: BASE_URL }])
  // 結果は Suspense の中で、hidden の器に居る間は数えても押せない (openRow と同じ)
  await openSearch(page, TILE_NOTE.key)
  const triggers = searchResults(page).getByRole('button', {
    name: `${noteName(TILE_NOTE)}の操作`,
    exact: true,
  })
  await expect(triggers).toHaveCount(2)
  await expectHydrated(triggers.first())
  return triggers
}

test.describe('画像モードのタイルの ⋮ メニュー', () => {
  test.beforeEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, TILE_NOTE)
    await page.goto(`/edit/${TILE_NOTE.id}`)
    const save = page.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(page)
    await memoEditor(page).click()
    // insertText は 1 回の入力なので、![ の括弧の自動補完が挟まらない
    await page.keyboard.insertText(TILE_BODY)
    await save.click()
    await expect(page).toHaveURL((url) => url.pathname === `/item/${TILE_NOTE.id}`)
    await closePage(page)
  })

  test.afterEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, TILE_NOTE)
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
    expect(message).toContain(`${noteName(TILE_NOTE)}をノートごとゴミ箱へ移動します`)
    expect(message).toContain('2 枚')
    // 取り消しが効かずに送っていても、一覧から消えるのは revalidate の後。
    // 直後に数えるだけでは検証にならないので、通信が落ち着くのを待って
    // (送っていればその応答まで) 読み直してから数える
    await page.waitForLoadState('networkidle')
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

// ゴミ箱の画像表示 (docs/107 §9)。表示形式の cookie は検索一覧と共有なので、
// 画像モードで消したノートはゴミ箱でも画像表示で並ぶ。そこから戻せること
test.describe('ゴミ箱の画像表示のタイルの ⋮ メニュー', () => {
  test.beforeEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, TILE_NOTE)
    await page.goto(`/edit/${TILE_NOTE.id}`)
    const save = page.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(page)
    await memoEditor(page).click()
    await page.keyboard.insertText(TILE_BODY)
    await save.click()
    await expect(page).toHaveURL((url) => url.pathname === `/item/${TILE_NOTE.id}`)
    // 画像モードの ⋮ からゴミ箱へ入れる (ユーザーが踏んだ流れ)
    const triggers = await openImageMode(page)
    page.once('dialog', (dialog) => void dialog.accept())
    await triggers.first().click()
    await page.getByRole('menuitem', { name: 'ゴミ箱へ移動', exact: true }).click()
    await expect(triggers).toHaveCount(0)
    await closePage(page)
  })

  test.afterEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, TILE_NOTE)
    await closePage(page)
  })

  async function openTrashTiles(page: Page) {
    await page.context().addCookies([{ name: 'view', value: 'image', url: BASE_URL }])
    await page.goto('/trash')
    await expect(page.getByRole('heading', { name: 'ゴミ箱', exact: true })).toBeVisible()
    const triggers = page.getByRole('button', {
      name: `${noteName(TILE_NOTE)}の操作`,
      exact: true,
    })
    await expect(triggers).toHaveCount(2)
    await expectHydrated(triggers.first())
    return triggers
  }

  test('⋮ の「復元」で戻り、検索一覧に再び出る', async ({ page }) => {
    // Arrange
    const triggers = await openTrashTiles(page)

    // Act: 復元は確認しない (戻すだけで失う物が無い)
    await triggers.nth(1).click()
    await page.getByRole('menuitem', { name: '復元', exact: true }).click()

    // Assert: 同じノートの 2 枚ともゴミ箱から消え、検索一覧に戻る
    await expect(triggers).toHaveCount(0)
    await openImageMode(page)
  })

  test('⋮ の「永久削除」は確認し、取り消せば残る', async ({ page }) => {
    // Arrange
    const triggers = await openTrashTiles(page)
    let message = ''
    page.once('dialog', (dialog) => {
      message = dialog.message()
      void dialog.dismiss()
    })

    // Act
    await triggers.first().click()
    await page.getByRole('menuitem', { name: '永久削除', exact: true }).click()

    // Assert: 行の永久削除と同じ文に、まとめて消える枚数を添える
    expect(message).toContain(`${noteName(TILE_NOTE)}を完全に削除します`)
    expect(message).toContain('2 枚')
    // 送っていればその応答まで待ってから読み直す (上の取り消しの試験と同じ)
    await page.waitForLoadState('networkidle')
    await page.reload()
    await expect(triggers).toHaveCount(2)
  })
})
