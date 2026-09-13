import { E2E_ITEM_PREFIX } from './env'
import {
  clearEditor,
  expect,
  memoEditor,
  newLoggedInPage,
  searchFor,
  test,
} from './helpers'
import { purgeFromTrash, removeE2eNote, searchResults, trashFromSearch } from './notes'

// ノートの一生: 作る → 保存して表示 → 一覧からペインで開く → ゴミ箱 → 永久削除。
// 前の段が作った物を次の段が使うので直列に流す (前が落ちたら後は skip)。
//
// 番号は採番 (/new) ではなく /edit/<番号> で直に決める。未登録の番号の
// 編集画面で「更新」すると、その番号で作られる (actions.ts の updateItemAction)。
// 採番するとローカル DB の次の番号を食い、片付けても本物の番号列に穴が見える
const ITEM_NO = `${E2E_ITEM_PREFIX}1`

// 走らせるたびに違う本文にする。前の回の表示が残っていても取り違えない
const BODY = `${E2E_ITEM_PREFIX} smoke ${Date.now()}`

test.describe.configure({ mode: 'serial' })

test.describe('ノートの一生', () => {
  test.beforeAll(async ({ browser }) => {
    // 前の回が途中で落ちて残した同じ番号を消しておく (無ければ何もしない)
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, ITEM_NO)
    await page.context().close()
  })

  test.afterAll(async ({ browser }) => {
    // 途中で落ちても本物の DB に残さない
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, ITEM_NO)
    await page.context().close()
  })

  test('未登録の番号を編集して保存すると、表示画面に本文が出る', async ({ page }) => {
    // Arrange
    await page.goto(`/edit/${ITEM_NO}`)
    await expect(page.getByRole('heading', { name: `edit #${ITEM_NO}` })).toBeVisible()
    // 「更新」は下部バーへ portal される。マウント後にしか現れないので、
    // これが見えればハイドレーションも済んでいる
    const save = page.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(page)

    // Act
    await memoEditor(page).pressSequentially(BODY, { delay: 10 })
    await save.click()

    // Assert
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_NO}`)
    await expect(page.getByText(BODY).first()).toBeVisible()
  })

  test('広い画面で一覧から開くと、ソフト遷移でノートのペインに出る (docs/86)', async ({
    page,
  }) => {
    // Arrange
    // lg (1024px) 以上。既定の 2 ペインでは一覧の横にノートのペインが出る
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await searchFor(page, ITEM_NO)
    const results = searchResults(page)
    // 押すのは見出しのリンク。行全体に ::after の当たり判定を広げている
    // (stretched link。ItemRow.tsx) ので、番号のリンクは膜の下で押せない
    const link = results.getByRole('link', { name: BODY, exact: true })
    // ハードナビゲーションなら window ごと作り直されて消える印
    await page.evaluate(() => {
      Object.assign(window, { __e2eSoftNav: true })
    })

    // Act
    await link.click()

    // Assert
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_NO}`)
    const pane = page.getByRole('region', { name: '選択したノート' })
    await expect(pane).toBeVisible()
    await expect(pane.getByText(BODY).first()).toBeVisible()
    // 一覧は残っている (全画面のノートに差し替わっていない)
    await expect(results).toBeVisible()
    expect(await page.evaluate(() => '__e2eSoftNav' in window)).toBe(true)
  })

  test('一覧からゴミ箱へ入れ、ゴミ箱から永久削除すると消える', async ({ page }) => {
    // Act
    const trashed = await trashFromSearch(page, ITEM_NO)
    const purged = await purgeFromTrash(page, ITEM_NO)

    // Assert
    expect(trashed).toBe(true)
    expect(purged).toBe(true)
    await page.reload()
    await expect(
      page.getByRole('link', { name: `#${ITEM_NO}`, exact: true }),
    ).toHaveCount(0)
  })
})
