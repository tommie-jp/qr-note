import type { Locator } from '@playwright/test'
import {
  clearEditor,
  closePage,
  expect,
  expectHydrated,
  memoEditor,
  newLoggedInPage,
  searchFor,
  test,
  openNoteChrome,
} from './helpers'
import {
  e2eNote,
  purgeFromTrash,
  removeE2eNote,
  rowOf,
  searchResults,
  trashFromSearch,
} from './notes'

// ノートの一生: 作る → 保存して表示 → 一覧からペインで開く (広い画面・スマホ幅)
// → 全画面で開いて閉じる → ゴミ箱 → 永久削除。
// 前の段が作った物を次の段が使うので直列に流す (前が落ちたら後は skip)。
//
// id は採番 (/new) ではなく /edit/<id> で直に決める (env.ts の e2eItemId)。
// 未登録の id の編集画面で「更新」すると、その id で作られる
// (app/actions/items.ts の updateItemAction)。決めた id なら、途中で落ちた回の
// 残りも同じ id で引いて消せる。
// 走らせるたびに違う本文にする。前の回の表示が残っていても取り違えない
const NOTE = e2eNote(1, `smoke ${Date.now()}`)
const ITEM_ID = NOTE.id
const BODY = NOTE.heading

test.describe.configure({ mode: 'serial' })

// ノートの器が 1 つに落ち着くのを待つ。3 / 2 ペインでは一覧から開いた直後、
// 先頭を出していた自動のノートと、横取りしたノート (読み込み中は骨組み) の
// 器が一瞬 2 つ並ぶ — 自動のほうは横取りがノートを持った後の effect で
// 引っ込む (PaneModeProvider の hasDetail)。検索結果の先頭が開くノート自身だと
// 本文の文字は先に見えてしまうので、文字ではなく器の数で待つ (CI で発覚)
async function expectSettledPane(pane: Locator): Promise<void> {
  await expect(pane).toHaveCount(1)
  await expect(pane.getByText('ノートを読み込み中…')).toHaveCount(0)
}

test.describe('ノートの一生', () => {
  test.beforeAll(async ({ browser }) => {
    // 前の回が途中で落ちて残した同じ id を消しておく (無ければ何もしない)
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await closePage(page)
  })

  test.afterAll(async ({ browser }) => {
    // 途中で落ちても本物の DB に残さない
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await closePage(page)
  })

  test('未登録の id を編集して保存すると、表示画面に本文が出る', async ({ page }) => {
    // Arrange
    await page.goto(`/edit/${ITEM_ID}`)
    await expect(page.getByRole('heading', { name: 'edit', exact: true })).toBeVisible()
    // 「更新」は下部バーへ portal される。マウント後にしか現れないので、
    // これが見えればハイドレーションも済んでいる
    const save = page.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(page)

    // Act
    await memoEditor(page).pressSequentially(BODY, { delay: 10 })
    await save.click()

    // Assert
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_ID}`)
    await expect(page.getByText(BODY).first()).toBeVisible()
  })

  test('広い画面で一覧から開くと、ソフト遷移でノートのペインに出る (docs/86)', async ({
    page,
  }) => {
    // Arrange
    // lg (1024px) 以上。既定の 2 ペインでは一覧の横にノートのペインが出る
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await searchFor(page, NOTE.key)
    const results = searchResults(page)
    // 押すのは見出しのリンク。行全体に ::after の当たり判定を広げている
    // (stretched link。components/item/ItemRow.tsx)
    const link = results.getByRole('link', { name: BODY, exact: true })
    // ハードナビゲーションなら window ごと作り直されて消える印
    await page.evaluate(() => {
      Object.assign(window, { __e2eSoftNav: true })
    })

    // Act
    await link.click()

    // Assert
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_ID}`)
    const pane = page.getByRole('region', { name: '選択したノート' })
    await expectSettledPane(pane)
    await expect(pane.getByText(BODY).first()).toBeVisible()
    // 一覧は残っている (全画面のノートに差し替わっていない)
    await expect(results).toBeVisible()
    expect(await page.evaluate(() => '__e2eSoftNav' in window)).toBe(true)
  })

  test('スマホ幅の 2 ペインでも、一覧とノートのペインが上下に並ぶ (docs/86 §4-16)', async ({
    page,
  }) => {
    // Arrange
    // 既定の 2 ペイン。以前は lg 未満でノートが全画面になり、一覧が隠れていた
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await searchFor(page, NOTE.key)
    const results = searchResults(page)
    const link = results.getByRole('link', { name: BODY, exact: true })

    // Act
    await link.click()

    // Assert
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_ID}`)
    const pane = page.getByRole('region', { name: '選択したノート' })
    await expectSettledPane(pane)
    await expect(pane.getByText(BODY).first()).toBeVisible()
    await expect(link).toBeVisible()
    // ノートは一覧の下 (全画面で覆っていない)
    const listBox = await results.boundingBox()
    const paneBox = await pane.boundingBox()
    expect(paneBox!.y).toBeGreaterThan(listBox!.y)
    // 常設のペインなので、押しても閉じられない「閉じる」は出さない
    await expect(pane.getByRole('button', { name: '閉じる' })).toHaveCount(0)
  })

  test('全画面で開いて「閉じる」を押すと、ノートを飛ばして一覧へ戻る (docs/86 §4-17)', async ({
    page,
  }) => {
    // Arrange
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await searchFor(page, NOTE.key)
    await searchResults(page).getByRole('link', { name: BODY, exact: true }).click()
    const pane = page.getByRole('region', { name: '選択したノート' })
    await expectSettledPane(pane)
    await expect(pane.getByText(BODY).first()).toBeVisible()
    // 横取りを抜けるハード遷移。着いた先は素の /item (ペインは無い)
    await pane.getByRole('link', { name: '全画面で開く' }).click()
    // 見出しは畳まれている (docs/108)。開いて「item」の見出しを確かめる
    await openNoteChrome(page)
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_ID}`)
    await expect(page.getByRole('heading', { name: 'item', exact: true })).toBeVisible()
    await expect(pane).toHaveCount(0)
    const close = page.getByRole('button', { name: '閉じる' })
    await expectHydrated(close)

    // Act
    await close.click()

    // Assert
    // ペインで開いていた同じノート (URL は /item) には戻らず、一覧まで戻る
    await expect(page).toHaveURL(
      (url) => url.pathname === '/' && url.searchParams.get('q') === NOTE.key,
    )
    await expect(searchResults(page)).toBeVisible()
  })

  test('一覧からゴミ箱へ入れ、ゴミ箱から永久削除すると消える', async ({ page }) => {
    // Act
    const trashed = await trashFromSearch(page, NOTE)
    const purged = await purgeFromTrash(page, NOTE)

    // Assert
    expect(trashed).toBe(true)
    expect(purged).toBe(true)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'ゴミ箱', exact: true })).toBeVisible()
    await expect(rowOf(page, page, ITEM_ID)).toHaveCount(0)
  })
})
