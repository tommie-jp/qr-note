import type { BrowserContext, Locator, Page } from '@playwright/test'
import { BASE_URL } from './env'
import {
  clearEditor,
  closePage,
  expect,
  expectHydrated,
  memoEditor,
  newLoggedInPage,
  test,
} from './helpers'
import { solidPng } from './imageBytes'
import { e2eNote, openSearch, removeE2eNote, searchResults } from './notes'

// 検索結果の画像ビューア (docs/116-検索結果の画像最大表示計画.md)。
// 画像を押すと 2 / 3 ペインではノートのペインの場所に画像だけが出て、
// 縦が全部ペインに収まる。1 ペインでは画面全体の覆い。← → で前後へ送れる。
//
// 画像の実体は route で配る (縦長と横長の 2 枚)。DB には本文の参照だけを書く
const NOTE = e2eNote(12, `image viewer ${Date.now()}`)
const IMAGES_PATH = '/api/images'
const TALL = '00000000-0000-4000-8000-0000000000b1.png'
const WIDE = '00000000-0000-4000-8000-0000000000b2.png'
const BODY = [NOTE.heading, `![](${IMAGES_PATH}/${TALL})`, `![](${IMAGES_PATH}/${WIDE})`, ''].join(
  '\n',
)

async function serveImages(context: BrowserContext): Promise<void> {
  const tall = solidPng(200, 1600, [200, 40, 40])
  const wide = solidPng(1600, 200, [40, 40, 200])
  await context.route(
    (url) => url.pathname === `${IMAGES_PATH}/${TALL}` || url.pathname === `${IMAGES_PATH}/${WIDE}`,
    async (route) => {
      const { pathname } = new URL(route.request().url())
      await route.fulfill({
        contentType: 'image/png',
        body: pathname.endsWith(TALL) ? tall : wide,
      })
    },
  )
}

async function openResults(page: Page, panes: '1' | '2' | '3', view: 'image' | 'compact') {
  await serveImages(page.context())
  await page.context().addCookies([
    { name: 'view', value: view, url: BASE_URL },
    { name: 'panes', value: panes, url: BASE_URL },
  ])
  await openSearch(page, NOTE.key)
  const openers = searchResults(page).getByRole('button', { name: '画像を大きく表示' })
  await expect(openers.first()).toBeVisible()
  await expectHydrated(openers.first())
  return openers
}

function viewerImage(scope: Page | Locator): Locator {
  return scope.getByRole('img', { name: 'ノートの画像', exact: true })
}

// 画像の box がペインの中に収まっているか (object-contain なので、box が
// 収まれば絵の全体も収まる)。原寸が読み終わるまで待ってから測る
async function expectInside(image: Locator, pane: Locator) {
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalHeight))
    .toBeGreaterThan(0)
  const box = await image.boundingBox()
  const paneBox = await pane.boundingBox()
  expect(box).not.toBeNull()
  expect(paneBox).not.toBeNull()
  if (!box || !paneBox) return
  expect(box.y).toBeGreaterThanOrEqual(paneBox.y - 1)
  expect(box.y + box.height).toBeLessThanOrEqual(paneBox.y + paneBox.height + 1)
  expect(box.height).toBeGreaterThan(paneBox.height / 2)
}

test.describe('検索結果の画像ビューア', () => {
  test.beforeEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await page.goto(`/edit/${NOTE.id}`)
    const save = page.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(page)
    await memoEditor(page).click()
    await page.keyboard.insertText(BODY)
    await save.click()
    await expect(page).toHaveURL((url) => url.pathname === `/item/${NOTE.id}`)
    await closePage(page)
  })

  test.afterEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await closePage(page)
  })

  test('3 ペインでは画像がペインに縦まで収まり、← → で前後へ送れる', async ({ page }) => {
    // Arrange
    const openers = await openResults(page, '3', 'image')
    await expect(openers).toHaveCount(2)

    // Act
    await openers.first().click()

    // Assert: ノートのペインの場所に画像だけが出る
    const pane = page.getByRole('region', { name: '画像の表示' })
    await expect(pane).toBeVisible()
    const image = viewerImage(pane)
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${TALL}`)
    await expectInside(image, pane)
    await expect(openers.first()).toHaveAttribute('aria-pressed', 'true')

    // Act / Assert: キーと釦で前後へ
    await page.keyboard.press('ArrowRight')
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${WIDE}`)
    await expectInside(image, pane)
    await pane.getByRole('button', { name: '前の画像' }).click()
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${TALL}`)
  })

  test('ペインの境界を動かしても画像はペインに収まったまま', async ({ page }) => {
    // Arrange
    const openers = await openResults(page, '3', 'image')
    await openers.first().click()
    const pane = page.getByRole('region', { name: '画像の表示' })
    const image = viewerImage(pane)
    await expectInside(image, pane)
    const before = await pane.boundingBox()

    // Act: 境界 (ノートのペインの PaneResizer) を上へ 120px
    const separator = page.locator('[role="separator"][aria-orientation="horizontal"]')
    const handle = await separator.boundingBox()
    if (!handle || !before) throw new Error('境界かペインが見つからない')
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 120, {
      steps: 5,
    })
    await page.mouse.up()

    // Assert
    await expect.poll(async () => (await pane.boundingBox())?.height ?? 0).toBeGreaterThan(
      before.height + 60,
    )
    await expectInside(image, pane)
  })

  test('「ノートを開く」でビューアが引っ込み、そのノートがペインに出る', async ({ page }) => {
    // Arrange
    const openers = await openResults(page, '3', 'image')
    await openers.first().click()
    const pane = page.getByRole('region', { name: '画像の表示' })
    await expect(pane).toBeVisible()

    // Act
    await pane.getByRole('link', { name: 'ノートを開く' }).click()

    // Assert
    await expect(page).toHaveURL((url) => url.pathname === `/item/${NOTE.id}`)
    await expect(pane).toHaveCount(0)
    await expect(page.getByRole('region', { name: '選択したノート' })).toContainText(NOTE.heading)
  })

  test('1 ペインでは画面全体の覆いで出て、Esc で閉じる', async ({ page }) => {
    // Arrange
    const openers = await openResults(page, '1', 'image')

    // Act
    await openers.nth(1).click()

    // Assert
    const image = viewerImage(page)
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${WIDE}`)
    await expect(page.getByRole('region', { name: '画像の表示' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(image).toHaveCount(0)
    // ノートは開いていない (一覧のまま)
    await expect(page).toHaveURL((url) => url.pathname === '/')
  })

  test('小表示の行のサムネからも開ける', async ({ page }) => {
    // Arrange: 行の顔は先頭の画像 1 枚
    const openers = await openResults(page, '2', 'compact')
    await expect(openers).toHaveCount(1)

    // Act
    await openers.first().click()

    // Assert
    const pane = page.getByRole('region', { name: '画像の表示' })
    await expect(viewerImage(pane)).toHaveAttribute('src', `${IMAGES_PATH}/${TALL}`)
    await expectInside(viewerImage(pane), pane)
  })
})
