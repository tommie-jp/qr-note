import type { Page } from '@playwright/test'
import { closePage, expect, expectHydrated, newLoggedInPage, test } from './helpers'
import { e2eNote, noteName, openSearch, putE2eNote, removeE2eNote } from './notes'

// 選択モードの一括タグの「元に戻す」。外したタグは、元の行・元の位置・元の
// 書き方 (2 行目以外のタグ行・行ごと消えたタグ行) のまま戻ること
const STAMP = `bulkundo${Date.now()}`
const TAG = 'e2eundo'
const UPPER = e2eNote(500, STAMP)
const LOWER = e2eNote(501, STAMP)
// 2 行目ではない所のタグ行 (他のタグと同居) と、タグ 1 つだけの行
const UPPER_MEMO = `${UPPER.heading}\n本文\n本文2\n#keep  #${TAG}\n続き`
const LOWER_MEMO = `${LOWER.heading}\n本文\n#${TAG}\n続き`

async function memoOf(page: Page, itemId: string): Promise<string> {
  const response = await page.request.get(`/api/items/${itemId}`)
  expect(response.status()).toBe(200)
  return (await response.json()).data.item.memo as string
}

test.describe('一括タグの元に戻す', () => {
  test.beforeEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await putE2eNote(page, UPPER, UPPER_MEMO)
    await putE2eNote(page, LOWER, LOWER_MEMO)
    await closePage(page)
  })

  test.afterEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, UPPER)
    await removeE2eNote(page, LOWER)
    await closePage(page)
  })

  test('タグを外してから元に戻すと、本文が 1 字違わず元に戻る', async ({ page }) => {
    // Arrange
    const results = await openSearch(page, STAMP)
    const selectButton = page.getByRole('button', { name: '選択', exact: true })
    await expectHydrated(selectButton)
    await selectButton.click()
    for (const note of [UPPER, LOWER]) {
      await results.getByRole('checkbox', { name: `${noteName(note)}を選択` }).check()
    }

    // Act: 外す
    await results.getByRole('button', { name: `#${TAG} ✕` }).click()

    // Assert: 外れた
    await expect(results.getByText(`2 件から #${TAG} を外しました`)).toBeVisible()
    expect(await memoOf(page, UPPER.id)).toBe(`${UPPER.heading}\n本文\n本文2\n#keep\n続き`)
    expect(await memoOf(page, LOWER.id)).toBe(`${LOWER.heading}\n本文\n続き`)

    // Act: 元に戻す
    await results.getByRole('button', { name: '元に戻す', exact: true }).click()

    // Assert: 元の行・元の位置・元の空白のまま戻った
    await expect(results.getByText('元に戻しました')).toBeVisible()
    expect(await memoOf(page, UPPER.id)).toBe(UPPER_MEMO)
    expect(await memoOf(page, LOWER.id)).toBe(LOWER_MEMO)
  })
})
