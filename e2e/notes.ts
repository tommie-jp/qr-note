import type { Locator, Page } from '@playwright/test'
import { E2E_ITEM_PREFIX } from './env'
import { expect, expectHydrated } from './helpers'

// E2E が作ったノートを UI から片付ける手順 (ゴミ箱 → 永久削除)。
// spec 本体と、途中で落ちたときの後始末 (afterAll) の両方がこれを通る。
//
// ローカル DB には本物のノートが入っている。**番号の頭が zze2e でなければ
// 何もしない** (assertE2eItemNo)。永久削除の確認ダイアログも、文面に
// その番号が入っているときだけ受け入れる

export function assertE2eItemNo(itemNo: string): void {
  if (!itemNo.startsWith(E2E_ITEM_PREFIX)) {
    throw new Error(`E2E のノートではない番号を触ろうとした: ${itemNo}`)
  }
}

// 検索結果の器 (components/search/SearchNav.tsx の SearchResults)
export function searchResults(page: Page): Locator {
  return page.locator('[data-search-results]')
}

// 一覧の行 (li) のうち、その番号のリンク (`#zze2e1`) を持つもの。
// has に渡す locator は行からの相対で引かれるので、page から作る
function rowOf(page: Page, scope: Page | Locator, itemNo: string): Locator {
  return scope.getByRole('listitem').filter({
    has: page.getByRole('link', { name: `#${itemNo}`, exact: true }),
  })
}

// 検索結果の行からゴミ箱へ入れる (docs/66-行アクション計画.md のホバーボタン)。
// 見つからなければ false (もう無い)
export async function trashFromSearch(page: Page, itemNo: string): Promise<boolean> {
  assertE2eItemNo(itemNo)
  await page.goto(`/?q=${encodeURIComponent(itemNo)}`)
  const results = searchResults(page)
  // **見えるまで待つ (toContainText では足りない)。** 結果は Suspense の中で、
  // 届いた HTML はしばらく hidden の器に入ったまま差し替えを待つ。文字は
  // その時点で読めてしまうが、行は隠れているので role では 0 件に数えられ、
  // 「もう無い」と取り違える (実際に踏んだ)
  await expect(results.getByText(`「${itemNo}」の検索結果`)).toBeVisible()

  const row = rowOf(page, results, itemNo)
  if ((await row.count()) === 0) {
    return false
  }
  // ボタンはホバー (か focus-within) の間だけ pointer-events を持つ
  const button = row.getByRole('button', {
    name: `#${itemNo} をゴミ箱へ移動`,
    exact: true,
  })
  await expectHydrated(button)
  await row.hover()
  await button.click()
  await expect(row).toHaveCount(0)
  return true
}

// /trash の行から永久削除する。見つからなければ false
export async function purgeFromTrash(page: Page, itemNo: string): Promise<boolean> {
  assertE2eItemNo(itemNo)
  await page.goto('/trash')
  await expect(page.getByRole('heading', { name: 'ゴミ箱', exact: true })).toBeVisible()

  const row = rowOf(page, page, itemNo)
  if ((await row.count()) === 0) {
    return false
  }
  const purge = row.getByRole('button', { name: '永久削除', exact: true })
  // ハイドレート前に押すと confirm を経ずに素の form 送信になる
  await expectHydrated(purge)

  const expectedMessage = `#${itemNo} を完全に削除します`
  page.once('dialog', (dialog) =>
    dialog.message().startsWith(expectedMessage) ? dialog.accept() : dialog.dismiss(),
  )
  await purge.click()
  await expect(row).toHaveCount(0)
  return true
}

// 途中で落ちた回の残りを消す (無ければ何もしない)
export async function removeE2eNote(page: Page, itemNo: string): Promise<void> {
  await trashFromSearch(page, itemNo)
  await purgeFromTrash(page, itemNo)
}
