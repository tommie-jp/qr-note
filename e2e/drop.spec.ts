import type { Locator, Page } from '@playwright/test'
import { e2eItemId } from './env'
import { closePage, dropOn, expect, memoEditor, newLoggedInPage, test } from './helpers'

// 編集画面へのドロップ (docs/105-画像ドロップ計画.md §3)。
//
// - **DB には書かない。** 保存しないので、id は /edit で開くだけ。
//   `/api/images` への送信は route で偽の封筒を返す
// - ドロップは合成の DragEvent で起こす。Playwright のドラッグは
//   ページ外のファイルを持ち込めない
// - **合成イベントでは「受け損ねたらブラウザがファイルを開く」既定動作は
//   起きない。** 枠外のドロップで編集画面が消えないことは手で確かめる
//   (Windows のエクスプローラから PNG を余白・ツールバーへ落とす)
const ITEM_ID = e2eItemId(13)
const IMAGES_PATH = '/api/images'
const FAKE_URL = `${IMAGES_PATH}/e2e0d4a1-0000-4000-8000-0000000000dd.png`
const EXTERNAL_IMAGE = 'https://example.com/pics/cat_(1).png'
const EXTERNAL_PAGE = 'https://example.com/article'

function memoField(page: Page): Locator {
  return page.locator('input[name="memo"]')
}

test.describe('編集画面へのドロップ', () => {
  let page: Page
  let posts = 0

  // 保存しない (dirty のまま閉じる) ので、テストごとにページを開いて閉じる
  test.beforeEach(async ({ browser }) => {
    posts = 0
    page = await newLoggedInPage(browser)
    await page.route(
      (url) => url.pathname === IMAGES_PATH,
      async (route) => {
        if (route.request().method() !== 'POST') {
          await route.fallback()
          return
        }
        posts += 1
        await route.fulfill({ json: { success: true, data: { url: FAKE_URL }, error: null } })
      },
    )
    await page.goto(`/edit/${ITEM_ID}`)
    await expect(page.getByRole('button', { name: '更新', exact: true })).toBeVisible()
    await memoEditor(page).click()
    await page.keyboard.insertText('abc')
    await expect(memoField(page)).toHaveValue('abc')
  })

  test.afterEach(async () => {
    await closePage(page)
  })

  test('本文の上に落としたファイルはアップロードして画像記法で入る', async () => {
    // Act
    await dropOn(memoEditor(page), { file: true })

    // Assert
    await expect(memoField(page)).toHaveValue(new RegExp(`!\\[\\]\\(${FAKE_URL}\\)`))
    expect(posts).toBe(1)
  })

  test('本文の外 (文字数の行) に落としてもカーソルの位置に 1 回だけ入る', async () => {
    // Arrange: 文字数の行は編集画面の受け皿の中で、本文の外
    const outside = page.getByText(/\d+ \/ [\d,]+/)

    // Act
    await dropOn(outside, { file: true })

    // Assert
    await expect(memoField(page)).toHaveValue(new RegExp(`^abc!\\[\\]\\(${FAKE_URL}\\)`))
    expect(posts).toBe(1)
  })

  test('別タブの画像を引っ張ると外部 URL のまま画像記法で入る', async () => {
    // Act
    await dropOn(memoEditor(page), {
      uriList: EXTERNAL_PAGE,
      html: `<a href="${EXTERNAL_PAGE}"><img src="${EXTERNAL_IMAGE}"></a>`,
    })

    // Assert: 丸括弧は % になり、アップロードはしない
    await expect(memoField(page)).toHaveValue(/!\[\]\(https:\/\/example\.com\/pics\/cat_%281%29\.png\)/)
    expect(posts).toBe(0)
  })

  test('画像でないリンクは今までどおり文字で入る', async () => {
    // Act
    await dropOn(memoEditor(page), { uriList: EXTERNAL_PAGE })

    // Assert
    await expect(memoField(page)).toHaveValue(new RegExp(EXTERNAL_PAGE))
    await expect(memoField(page)).not.toHaveValue(/!\[\]/)
    expect(posts).toBe(0)
  })

  test('画像を含む文章を引いても、画像 1 枚に化けず文字で入る', async () => {
    // Act
    await dropOn(memoEditor(page), {
      text: 'hello world',
      html: `<p>hello <img src="${EXTERNAL_IMAGE}"> world</p>`,
    })

    // Assert
    await expect(memoField(page)).toHaveValue(/hello world/)
    await expect(memoField(page)).not.toHaveValue(/!\[\]/)
  })

  test('画像でないリンクを本文の外に落とすと、カーソルの位置に文字で入る', async () => {
    // Arrange
    const outside = page.getByText(/\d+ \/ [\d,]+/)

    // Act
    await dropOn(outside, { uriList: EXTERNAL_PAGE })

    // Assert
    await expect(memoField(page)).toHaveValue(`abc${EXTERNAL_PAGE}`)
  })
})
