import type { Locator, Page } from '@playwright/test'
import { E2E_HEADING_PREFIX, E2E_ITEM_PREFIX, e2eItemId, e2eKey } from './env'
import { expect, expectHydrated } from './helpers'

// E2E が作ったノートを UI から片付ける手順 (ゴミ箱 → 永久削除)。
// spec 本体と、途中で落ちたときの後始末 (afterAll) の両方がこれを通る。
//
// ローカル DB には本物のノートが入っている。**id の頭が E2E_ITEM_PREFIX で
// なければ何もしない** (assertE2eItemId)。行は id のリンク (`/item/<id>`) で
// 特定し、永久削除の確認ダイアログも、文面がそのノートの呼び名 (`「zze2e7 …」`)
// で始まるときだけ受け入れる

// E2E のノート 1 件。id は固定の UUID (env.ts の e2eItemId)、本文 1 行目
// (= 一覧の見出し・読み上げの呼び名) は key (`zze2e7`) で始まる
export interface E2eNote {
  readonly id: string
  // 検索語。見出しの頭でもある (`zze2e7`)
  readonly key: string
  // 本文 1 行目。key + 空白 + label
  readonly heading: string
}

// n 番の E2E ノート。label には走らせるたびに変わる印 (Date.now()) を入れて
// よい — 片付けは id と key しか見ないので、前の回の残りも消せる
export function e2eNote(n: number, label: string): E2eNote {
  const key = e2eKey(n)
  return { id: e2eItemId(n), key, heading: `${key} ${label}` }
}

// 読み上げ名・確認文の呼び名 (lib/items/noteName.ts と同じ形。見出しは 40 字以内に
// 収めること — 長いと本体が切って「…」を付ける)
export function noteName(note: Pick<E2eNote, 'heading'>): string {
  return `「${note.heading}」`
}

export function assertE2eItemId(itemId: string): void {
  if (!itemId.startsWith(E2E_ITEM_PREFIX)) {
    throw new Error(`E2E のノートではない id を触ろうとした: ${itemId}`)
  }
}

// その key の見出しを持つノートの呼び名で始まる文 (前の回の残りは見出しの
// 後ろが違うので、key の後ろは問わない)。key は英数字だけなのでそのまま正規表現に置ける
function startsWithNameOf(key: string): RegExp {
  return new RegExp(`^「${key}[ 」]`)
}

// 検索結果の器 (components/search/SearchNav.tsx の SearchResults)
export function searchResults(page: Page): Locator {
  return page.locator('[data-search-results]')
}

// 一覧の行 (li) のうち、そのノートを開くリンク (`/item/<id>`。検索一覧では
// `?q=` が続く) を持つもの。has に渡す locator は行からの相対で引かれるので、page から作る
export function rowOf(page: Page, scope: Page | Locator, itemId: string): Locator {
  return scope.getByRole('listitem').filter({
    has: page.locator(`a[href^="/item/${itemId}"]`),
  })
}

// key の全文検索の結果を開き、行が差し替わるまで待つ
export async function openSearch(page: Page, key: string): Promise<Locator> {
  await page.goto(`/?q=${encodeURIComponent(key)}`)
  const results = searchResults(page)
  // **見えるまで待つ (toContainText では足りない)。** 結果は Suspense の中で、
  // 届いた HTML はしばらく hidden の器に入ったまま差し替えを待つ。文字は
  // その時点で読めてしまうが、行は隠れているので role では 0 件に数えられ、
  // 「もう無い」と取り違える (実際に踏んだ)
  await expect(results.getByText(`「${key}」の検索結果`)).toBeVisible()
  return results
}

// 検索結果の行からゴミ箱へ入れる (docs/66-行アクション計画.md のホバーボタン)。
// 見つからなければ false (もう無い)
export async function trashFromSearch(
  page: Page,
  note: Pick<E2eNote, 'id' | 'key'>,
): Promise<boolean> {
  assertE2eItemId(note.id)
  const results = await openSearch(page, note.key)

  const row = rowOf(page, results, note.id)
  if ((await row.count()) === 0) {
    return false
  }
  // ボタンはホバー (か focus-within) の間だけ pointer-events を持つ。
  // 名前は `「見出し」をゴミ箱へ移動`。行はもう id で絞ってあり、ゴミ箱は戻せるので、
  // 見出しは問わない (途中で落ちて 1 行目が変わったまま残ったノートも入れられる)
  const button = row.getByRole('button', { name: /」をゴミ箱へ移動$/ })
  await expectHydrated(button)
  await row.hover()
  await button.click()
  await expect(row).toHaveCount(0)
  return true
}

// /trash の行から永久削除する。見つからなければ false
export async function purgeFromTrash(
  page: Page,
  note: Pick<E2eNote, 'id' | 'key'>,
): Promise<boolean> {
  assertE2eItemId(note.id)
  await page.goto('/trash')
  await expect(page.getByRole('heading', { name: 'ゴミ箱', exact: true })).toBeVisible()

  const row = rowOf(page, page, note.id)
  if ((await row.count()) === 0) {
    return false
  }
  const purge = row.getByRole('button', { name: '永久削除', exact: true })
  // ハイドレート前に押すと confirm を経ずに素の form 送信になる
  await expectHydrated(purge)

  // 文面が `「zze2e<n> …」を完全に削除します` のときだけ受け入れる
  // (E2E_HEADING_PREFIX で始まらない呼び名の削除は決して通さない)
  const expected = startsWithNameOf(note.key)
  page.once('dialog', (dialog) => {
    const message = dialog.message()
    const isOurs =
      message.startsWith(`「${E2E_HEADING_PREFIX}`) &&
      expected.test(message) &&
      message.includes('」を完全に削除します')
    return isOurs ? dialog.accept() : dialog.dismiss()
  })
  await purge.click()
  await expect(row).toHaveCount(0)
  return true
}

// 途中で落ちた回の残りを消す (無ければ何もしない)
export async function removeE2eNote(
  page: Page,
  note: Pick<E2eNote, 'id' | 'key'>,
): Promise<void> {
  await trashFromSearch(page, note)
  await purgeFromTrash(page, note)
}
