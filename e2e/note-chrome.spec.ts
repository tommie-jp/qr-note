import type { Locator, Page } from '@playwright/test'
import {
  clearEditor,
  closePage,
  expect,
  expectHydrated,
  memoEditor,
  newLoggedInPage,
  newTouchPage,
  openNoteChrome,
  selectNoteTab,
  test,
} from './helpers'
import { e2eNote, openSearch, removeE2eNote } from './notes'

// ノートの全画面表示 (docs/108-ノート全画面表示計画.md)。
// 読むタブの間は見出し行・タグ・タブ・時刻を畳み、上端の行へのホバー (PC)・
// ⋯ (指)・Tab (キーボード) で本文の上に重ねて出す
const NOTE = e2eNote(108, `chrome ${Date.now()}`)
const ITEM_ID = NOTE.id
const BODY = NOTE.heading

function heading(page: Page) {
  // 見出しは「item」だけ (番号は出ない)
  return page.getByRole('heading', { name: 'item', exact: true })
}

function bar(page: Page) {
  return page.locator('[data-note-chrome-bar]')
}

function trigger(scope: Page | Locator) {
  return scope.getByRole('button', { name: 'ノートの操作', exact: true })
}

async function openNote(page: Page): Promise<void> {
  await page.goto(`/item/${ITEM_ID}`)
  await expect(page.getByText(BODY).first()).toBeVisible()
  // ⋯ は「常に出す」の端末には無いので、行のほうで待つ
  await expectHydrated(bar(page))
}

test.describe('ノートの操作を畳んで重ねる', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await page.goto(`/edit/${ITEM_ID}`)
    const save = page.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(page)
    await memoEditor(page).pressSequentially(`${BODY}\n\n#e2etag`, { delay: 10 })
    await save.click()
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_ID}`)
    await closePage(page)
  })

  test.afterAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await closePage(page)
  })

  test('開いた直後は本文だけで、操作は畳まれている', async ({ page }) => {
    // Act
    await openNote(page)

    // Assert: 本文は上端の行のすぐ下から始まる
    await expect(heading(page)).toHaveCount(0)
    await expect(page.getByRole('tablist')).toHaveCount(0)
    await expect(page.getByText('作成:')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '閉じる' })).toBeVisible()
  })

  test('PC は上端の行にマウスを載せると重ねて出し、離れると消える', async ({ page }) => {
    // Arrange
    await openNote(page)
    const body = page.getByText(BODY).first()
    const before = await body.boundingBox()

    // Act
    await bar(page).hover()

    // Assert: 見出し・タグ・タブ・時刻が出る。本文は押し下げない
    await expect(heading(page)).toBeVisible()
    const overlay = page.locator('[data-note-chrome-overlay]')
    await expect(overlay.getByRole('link', { name: '#e2etag' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '編集' })).toBeVisible()
    await expect(page.getByText('作成:')).toBeVisible()
    expect((await body.boundingBox())!.y).toBe(before!.y)

    // 面の上へ移っても消えない (面は DOM の上では行の子)
    await heading(page).hover()
    await page.waitForTimeout(400)
    await expect(heading(page)).toBeVisible()

    // Act: 行と面の外へ出る
    const viewport = page.viewportSize()!
    await page.mouse.move(viewport.width / 2, viewport.height - 10)

    // Assert
    await expect(heading(page)).toHaveCount(0)
  })

  test('指の画面は ⋯ を押すと出し、外を押すと消える', async ({ browser }) => {
    // Arrange
    const page = await newTouchPage(browser)
    await openNote(page)

    // Act
    await trigger(page).tap()

    // Assert
    await expect(heading(page)).toBeVisible()
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true')

    // Act: 面の外 (画面の下の方) を押す
    const viewport = page.viewportSize()!
    await page.touchscreen.tap(viewport.width / 2, viewport.height - 20)

    // Assert
    await expect(heading(page)).toHaveCount(0)
    await closePage(page)
  })

  test('指の画面で別のタブを選ぶと面を閉じ、その中身を見せる', async ({ browser }) => {
    // Arrange
    const page = await newTouchPage(browser)
    await openNote(page)
    await openNoteChrome(page)

    // Act
    await page.getByRole('tab', { name: 'テキスト' }).tap()

    // Assert
    await expect(heading(page)).toHaveCount(0)
    await expect(page.locator('pre').getByText(BODY)).toBeVisible()
    await closePage(page)
  })

  test('編集タブの間は畳まず、本文の上に積む', async ({ page }) => {
    // Arrange
    await openNote(page)

    // Act
    await selectNoteTab(page, '編集')
    await expect(memoEditor(page)).toBeVisible()
    // マウスを行から離しても消えない (ホバーで出ているのではない)
    const viewport = page.viewportSize()!
    await page.mouse.move(viewport.width / 2, viewport.height - 10)
    await page.waitForTimeout(400)

    // Assert
    await expect(heading(page)).toBeVisible()
    await expect(page.getByRole('tablist')).toBeVisible()
    await expect(trigger(page)).toHaveCount(0)

    // Act: 読むタブへ戻ると畳む
    await page.getByRole('tab', { name: 'markdown' }).click()
    await page.mouse.move(viewport.width / 2, viewport.height - 10)

    // Assert
    await expect(heading(page)).toHaveCount(0)
  })

  test('Tab で上端の行に入ると出す', async ({ page }) => {
    // Arrange
    await openNote(page)

    // Act: 「閉じる」へキーボードでフォーカスを入れる
    await page.getByRole('button', { name: '閉じる' }).focus()
    await page.keyboard.press('Tab')

    // Assert
    await expect(heading(page)).toBeVisible()

    // Act: Esc で閉じる
    await page.keyboard.press('Escape')

    // Assert
    await expect(heading(page)).toHaveCount(0)
  })

  test('📌 で常に出すにすると、開き直しても積んだまま', async ({ page }) => {
    // Arrange
    await openNote(page)
    await openNoteChrome(page)

    // Act
    await page.getByRole('button', { name: '操作を畳む', exact: true }).click()
    await openNote(page)
    const viewport = page.viewportSize()!
    await page.mouse.move(viewport.width / 2, viewport.height - 10)

    // Assert
    await expect(heading(page)).toBeVisible()
    await expect(page.getByRole('tablist')).toBeVisible()
    await expect(trigger(page)).toHaveCount(0)

    // Act: 戻す
    await page.getByRole('button', { name: '操作を常に表示', exact: true }).click()

    // Assert
    await expect(heading(page)).toHaveCount(0)
  })

  test('公開中なら、畳んでいる間も行に印を出す', async ({ page }) => {
    // Arrange: 重ねた面から公開する (確認ダイアログは受け入れる)
    await openNote(page)
    await openNoteChrome(page)
    await expect(bar(page).getByRole('img', { name: '公開中' })).toHaveCount(0)
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '非公開', exact: true }).click()
    await expect(page.getByRole('button', { name: '公開中', exact: true })).toBeVisible()

    // Act: 面を閉じる
    const viewport = page.viewportSize()!
    await page.mouse.move(viewport.width / 2, viewport.height - 10)
    await page.keyboard.press('Escape')

    // Assert
    await expect(heading(page)).toHaveCount(0)
    await expect(bar(page).getByRole('img', { name: '公開中' })).toBeVisible()

    // 後始末: 非公開へ戻す
    await openNoteChrome(page)
    await page.getByRole('button', { name: '公開中', exact: true }).click()
    await expect(page.getByRole('button', { name: '非公開', exact: true })).toBeVisible()
  })

  // 読むタブ ⇄ 編集で積む形と畳む形が入れ替わる。そのたびにパネルを作り直すと、
  // 開いたエディタが捨てられ、打ちかけ・undo・離脱の確認が消える (レビューで判明)
  test('編集と読むタブを行き来しても、エディタを作り直さない', async ({ page }) => {
    // Arrange
    await openNote(page)
    await selectNoteTab(page, '編集')
    await expect(memoEditor(page)).toBeVisible()
    await memoEditor(page).evaluate((el) => {
      ;(el as HTMLElement & { e2eMark?: boolean }).e2eMark = true
    })

    // Act
    await page.getByRole('tab', { name: 'markdown' }).click()
    await expect(heading(page)).toHaveCount(0)
    await selectNoteTab(page, '編集')

    // Assert
    await expect(memoEditor(page)).toBeVisible()
    const kept = await memoEditor(page).evaluate(
      (el) => (el as HTMLElement & { e2eMark?: boolean }).e2eMark === true,
    )
    expect(kept).toBe(true)
  })

  test('PC で重ねた面からタブを選ぶと、マウスが上に居ても閉じる', async ({ page }) => {
    // Arrange
    await openNote(page)
    await bar(page).hover()
    await expect(heading(page)).toBeVisible()

    // Act
    await page.getByRole('tab', { name: 'テキスト' }).click()

    // Assert
    await expect(heading(page)).toHaveCount(0)
    await expect(page.locator('pre').getByText(BODY)).toBeVisible()
  })
})

// 下部ペイン (既定の 2 ペイン) では、畳む形のとき上端の行を本文の上に浮かせ、
// 行の高さを本文に貸す (docs/108 §3-6)
test.describe('下部ペインでは操作の行を本文の上に浮かせる', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await page.goto(`/edit/${ITEM_ID}`)
    const save = page.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(page)
    await memoEditor(page).pressSequentially(`${BODY}\n\n#e2etag`, { delay: 10 })
    await save.click()
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_ID}`)
    await closePage(page)
  })

  test.afterAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await closePage(page)
  })

  // 一覧からソフト遷移でペインに開く (ハード遷移の /item は全画面)
  async function openInPane(page: Page) {
    const results = await openSearch(page, NOTE.key)
    await results.getByRole('link', { name: BODY, exact: true }).click()
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_ID}`)
    const pane = page.getByRole('region', { name: '選択したノート' })
    await expect(pane.getByText(BODY).first()).toBeVisible()
    await expectHydrated(pane.locator('[data-note-chrome-bar]'))
    return pane
  }

  test('本文はペインの上端から始まり、行の左側は本文を塞がない', async ({ page }) => {
    // Act
    const pane = await openInPane(page)

    // Assert: 行は浮いている
    await expect(pane.locator('[data-note-chrome-bar][data-note-chrome-floating]')).toHaveCount(1)
    await expect(pane.getByRole('link', { name: '全画面で開く', exact: true })).toBeVisible()
    // 本文 (1 行目) はペインの上端近くから始まる (行の 48px ぶん下がっていない)
    const paneBox = (await pane.boundingBox())!
    const body = (await pane.getByText(BODY).first().boundingBox())!
    expect(body.y - paneBox.y).toBeLessThan(40)
    // 行の左側 (空いている所) を指すと、当たるのは行ではなく本文側
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-note-chrome-bar]') === null,
      [paneBox.x + 24, paneBox.y + 24] as const,
    )
    expect(hit).toBe(true)
  })

  test('PC は札にマウスを載せると重ねて出す', async ({ page }) => {
    // Arrange
    const pane = await openInPane(page)
    const body = pane.getByText(BODY).first()
    const before = (await body.boundingBox())!

    // Act
    await trigger(pane).hover()

    // Assert: 重ねる面は札の下から出て、本文は押し下げない
    await expect(pane.getByRole('heading', { name: 'item', exact: true })).toBeVisible()
    await expect(pane.getByRole('tab', { name: '編集' })).toBeVisible()
    expect((await body.boundingBox())!.y).toBe(before.y)

    // Act: 離れる
    const viewport = page.viewportSize()!
    await page.mouse.move(viewport.width / 2, 10)

    // Assert
    await expect(pane.getByRole('heading', { name: 'item', exact: true })).toHaveCount(0)
  })

  test('編集タブの間は浮かせず、行に戻す', async ({ page }) => {
    // Arrange
    const pane = await openInPane(page)

    // Act
    await openNoteChrome(pane)
    await pane.getByRole('tab', { name: '編集' }).click()
    await expect(memoEditor(page)).toBeVisible()

    // Assert: 見出し行が積まれ、行は浮いていない
    await expect(pane.getByRole('heading', { name: 'item', exact: true })).toBeVisible()
    await expect(pane.locator('[data-note-chrome-floating]')).toHaveCount(0)
    await expect(pane.locator('[data-note-chrome-spacer]')).toHaveCount(0)

    // Act: 読むタブへ戻ると浮く
    await pane.getByRole('tab', { name: 'markdown' }).click()

    // Assert
    await expect(pane.locator('[data-note-chrome-floating]')).toHaveCount(1)
  })
})
