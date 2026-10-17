import type { Locator, Page } from '@playwright/test'
import { E2E_ITEM_PREFIX } from './env'
import { closePage, expect, memoEditor, newLoggedInPage, test } from './helpers'
import { solidPng } from './imageBytes'

// 編集画面へのドロップ (docs/105-画像ドロップ計画.md §3)。
//
// - **DB には書かない。** 保存しないので、番号は /edit で開くだけ。
//   `/api/images` への送信は route で偽の封筒を返す
// - ドロップは合成の DragEvent で起こす。Playwright のドラッグは
//   ページ外のファイルを持ち込めない
// - **合成イベントでは「受け損ねたらブラウザがファイルを開く」既定動作は
//   起きない。** 枠外のドロップで編集画面が消えないことは手で確かめる
//   (Windows のエクスプローラから PNG を余白・ツールバーへ落とす)
const ITEM_NO = `${E2E_ITEM_PREFIX}drop`
const IMAGES_PATH = '/api/images'
const FAKE_URL = `${IMAGES_PATH}/e2e0d4a1-0000-4000-8000-0000000000dd.png`
const EXTERNAL_IMAGE = 'https://example.com/pics/cat_(1).png'
const EXTERNAL_PAGE = 'https://example.com/article'

interface DropPayload {
  file?: boolean
  uriList?: string
  html?: string
  // 文字の選択を引いたときの形 (uri-list が無く text/plain と text/html だけ)
  text?: string
}

function memoField(page: Page): Locator {
  return page.locator('input[name="memo"]')
}

// target の中心に drop を投げる (dragenter → dragover → drop の順)
async function dropOn(target: Locator, payload: DropPayload): Promise<void> {
  const png = Array.from(solidPng(40, 30, [200, 40, 40]))
  await target.evaluate(
    (el, { png, payload }) => {
      const dt = new DataTransfer()
      if (payload.file) {
        dt.items.add(new File([new Uint8Array(png)], 'drop.png', { type: 'image/png' }))
      }
      if (payload.uriList !== undefined) {
        dt.setData('text/uri-list', payload.uriList)
        dt.setData('text/plain', payload.uriList)
      }
      if (payload.text !== undefined) {
        dt.setData('text/plain', payload.text)
      }
      if (payload.html !== undefined) {
        dt.setData('text/html', payload.html)
      }
      const rect = el.getBoundingClientRect()
      const init = {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }
      for (const type of ['dragenter', 'dragover', 'drop']) {
        el.dispatchEvent(new DragEvent(type, init))
      }
    },
    { png, payload },
  )
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
    await page.goto(`/edit/${ITEM_NO}`)
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
