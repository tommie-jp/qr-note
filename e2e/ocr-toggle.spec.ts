import type { Locator, Page } from '@playwright/test'
import { E2E_ITEM_PREFIX } from './env'
import {
  clearEditor,
  closePage,
  dropOn,
  expect,
  memoEditor,
  newLoggedInPage,
  test,
} from './helpers'

// OCR の切り替えと「ノートの全画像を OCR」のメニュー
// (docs/106-OCR切替と全画像OCR計画.md §4)。
//
// - **DB には書かない。** 保存しないので、番号は /edit で開くだけ。
//   `/api/images` の送信は route で偽の封筒を返す
// - **OCR そのものは走らせない。** モデルの読み込みは重く、E2E では
//   「プレースホルダが入るか」だけを見る。挿入時 OCR は保存後の画像を
//   取り直してから読むので、その取り直しを route で 5 秒止め、その間に
//   プレースホルダを確かめる (止めないと 404 で即座に消える)
// - 全画像 OCR の実行・中止は手で確かめる (モデルが要る)
const ITEM_NO = `${E2E_ITEM_PREFIX}ocr`
const IMAGES_PATH = '/api/images'
const FAKE_URL = `${IMAGES_PATH}/e2e0d4a1-0000-4000-8000-0000000000ee.png`
const PLACEHOLDER = /OCR処理中/
const HOLD_IMAGE_MS = 5_000

function memoField(page: Page): Locator {
  return page.locator('input[name="memo"]')
}

function ocrToggle(page: Page): Locator {
  return page.getByRole('button', { name: /^OCR (する|しない)$/ })
}

async function openEditor(page: Page): Promise<void> {
  await page.goto(`/edit/${ITEM_NO}`)
  await expect(page.getByRole('button', { name: '更新', exact: true })).toBeVisible()
}

test.describe('OCR の切り替え', () => {
  let page: Page

  test.beforeEach(async ({ browser }) => {
    page = await newLoggedInPage(browser)
    await page.route(
      (url) => url.pathname === IMAGES_PATH || url.pathname === FAKE_URL,
      async (route) => {
        const request = route.request()
        if (request.method() === 'POST') {
          await route.fulfill({ json: { success: true, data: { url: FAKE_URL }, error: null } })
          return
        }
        // OCR 用の取り直し。止めている間にプレースホルダを見る
        await new Promise((resolve) => setTimeout(resolve, HOLD_IMAGE_MS))
        await route.fulfill({ status: 404, body: '' }).catch(() => {})
      },
    )
    await openEditor(page)
  })

  test.afterEach(async () => {
    await closePage(page)
  })

  test('既定は「OCR する」で、画像を落とすとプレースホルダが入る', async () => {
    // Arrange
    await expect(ocrToggle(page)).toHaveText('OCR する')
    await expect(ocrToggle(page)).toHaveAttribute('aria-pressed', 'true')

    // Act
    await dropOn(memoEditor(page), { file: true })

    // Assert
    await expect(memoField(page)).toHaveValue(PLACEHOLDER)
  })

  test('「OCR しない」にすると、開き直しても残り、落とした画像は読まない', async () => {
    // Arrange: 切り替えは本文に触れないので、開き直しても離脱の確認は出ない
    await ocrToggle(page).click()
    await expect(ocrToggle(page)).toHaveText('OCR しない')
    await openEditor(page)
    await expect(ocrToggle(page)).toHaveAttribute('aria-pressed', 'false')

    // Act
    await dropOn(memoEditor(page), { file: true })

    // Assert: 画像は入り、プレースホルダは入らない
    await expect(memoField(page)).toHaveValue(new RegExp(FAKE_URL))
    expect(await memoField(page).inputValue()).not.toMatch(PLACEHOLDER)
  })

  test('全画像のメニューは、OCR の引用が付いていない画像だけを数える', async () => {
    // Arrange: 2 枚のうち 1 枚は読んだ跡 (直後の引用) がある
    const read = `![](${IMAGES_PATH}/e2e0d4a1-0000-4000-8000-0000000000a1.png)`
    const unread = `![](${IMAGES_PATH}/e2e0d4a1-0000-4000-8000-0000000000a2.png)`
    await clearEditor(page)
    await page.keyboard.insertText(`${read}\n\n> 読めた文字\n\n${unread}\n`)

    // Act
    await page.getByRole('button', { name: '画像をOCR' }).click()

    // Assert
    await expect(page.getByRole('menuitem', { name: 'ノートの全画像 (1 枚)' })).toBeEnabled()
    await expect(page.getByRole('menuitem', { name: /この画像/ })).toBeVisible()
  })
})
