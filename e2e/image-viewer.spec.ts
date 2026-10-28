import { readFileSync } from 'node:fs'
import path from 'node:path'
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
    // スライドショーの入口は画像表示だけ (行の表示はサムネが 1 ノート 1 枚)
    await expect(
      searchResults(page).getByRole('button', { name: 'スライドショー', exact: true }),
    ).toHaveCount(0)
  })
})

// スライドショー (docs/117-検索結果のスライドショー計画.md)。送る間隔は
// いちばん短い 3 秒にして待ち時間を詰める (端末の設定 = localStorage)
const SLIDESHOW_INTERVAL_KEY = 'qr-search:slideshow-interval'
// 3 秒の間隔 + 原寸の読み込み。expect の既定 (5 秒) では際どい
const SLIDE_WAIT_MS = 10_000

test.describe('検索結果のスライドショー', () => {
  test.beforeEach(async ({ browser, page }) => {
    await page.addInitScript((key) => {
      window.localStorage.setItem(key, '3')
    }, SLIDESHOW_INTERVAL_KEY)
    const setup = await newLoggedInPage(browser)
    await removeE2eNote(setup, NOTE)
    await setup.goto(`/edit/${NOTE.id}`)
    const save = setup.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(setup)
    await memoEditor(setup).click()
    await setup.keyboard.insertText(BODY)
    await save.click()
    await expect(setup).toHaveURL((url) => url.pathname === `/item/${NOTE.id}`)
    await closePage(setup)
  })

  test.afterEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await closePage(page)
  })

  test('一覧の「スライドショー」で先頭から全画面で流れ、末尾の次は先頭へ戻る', async ({
    page,
  }) => {
    // Arrange
    await openResults(page, '3', 'image')
    const start = searchResults(page).getByRole('button', { name: 'スライドショー', exact: true })

    // Act
    await start.click()

    // Assert: ペインではなく全画面の覆いで、先頭の 1 枚から
    const image = viewerImage(page)
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${TALL}`)
    await expect(page.getByRole('region', { name: '画像の表示' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '送る間隔 3 秒' })).toBeAttached()

    // Assert: 触らずに待つと次へ送られ、続きの無い末尾の次は先頭へ戻る
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${WIDE}`, {
      timeout: SLIDE_WAIT_MS,
    })
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${TALL}`, {
      timeout: SLIDE_WAIT_MS,
    })
    // 戻った後も再生は続いている
    await expect(
      page.locator('[data-image-viewer]').getByRole('button', { name: 'スライドショーを止める' }),
    ).toBeAttached()
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${WIDE}`, {
      timeout: SLIDE_WAIT_MS,
    })
  })

  test('ペインの ▶ で全画面になり、画像を押すと閉じずに一時停止、→ で手送り', async ({
    page,
  }) => {
    // Arrange
    const openers = await openResults(page, '3', 'image')
    await openers.first().click()
    const pane = page.getByRole('region', { name: '画像の表示' })
    await expect(pane).toBeVisible()

    // Act: ペインの ▶
    await pane.getByRole('button', { name: 'スライドショー', exact: true }).click()

    // Assert: 全画面の覆いで再生中
    await expect(pane).toHaveCount(0)
    const image = viewerImage(page)
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${TALL}`)
    const viewer = page.locator('[data-image-viewer]')
    await expect(viewer.getByRole('button', { name: 'スライドショーを止める' })).toBeAttached()

    // Act: 画像を押す (再生中は閉じずに一時停止)
    await image.click()

    // Assert: 止まっていて、待っても送られない
    await expect(viewer.getByRole('button', { name: 'スライドショー', exact: true })).toBeVisible()
    await page.waitForTimeout(4_000)
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${TALL}`)

    // Act / Assert: 手で送れて、Esc で閉じる
    await page.keyboard.press('ArrowRight')
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${WIDE}`)
    await page.keyboard.press('Escape')
    await expect(image).toHaveCount(0)
  })

  test('Space で再生と一時停止を切り替え、手で送ると止まる', async ({ page }) => {
    // Arrange: 1 ペインの覆いで開く (止まっている)
    const openers = await openResults(page, '1', 'image')
    await openers.first().click()
    const viewer = page.locator('[data-image-viewer]')
    const image = viewerImage(page)
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${TALL}`)

    // Act: Space で再生
    await page.keyboard.press('Space')

    // Assert
    await expect(viewer.getByRole('button', { name: 'スライドショーを止める' })).toBeAttached()

    // Act: ← で手送り (先頭なので動かないが、再生は止まる)
    await page.keyboard.press('ArrowLeft')

    // Assert
    await expect(viewer.getByRole('button', { name: 'スライドショー', exact: true })).toBeAttached()
    await page.waitForTimeout(4_000)
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${TALL}`)
  })
})

// 2 ページ目にまたがる送り (docs/116 §4)。2 / 3 ペインの一覧は内側でスクロール
// するので、末尾の「さらに表示」は → で寄せても器の外に隠れたまま読まれず、
// 最後の画像で止まっていた。ビューアが次のページを直接頼むことを確かめる。
// 1 ページは 20 件 (lib/items/limits.ts の PAGE_SIZE) なので 21 件作る
const PAGED_TOKEN = `zzvwpage${Date.now()}`
const PAGED_COUNT = 21
const PAGED_NOTES = Array.from({ length: PAGED_COUNT }, (_, i) =>
  e2eNote(200 + i, PAGED_TOKEN),
)
const pagedImage = (i: number) =>
  `00000000-0000-4000-8000-${String(200 + i).padStart(12, '0')}.png`
// ノート 1 件の作成・片付けは数秒かかる。21 件ぶんの上限
const PAGED_HOOK_TIMEOUT_MS = 600_000

test.describe('検索結果の画像ビューア (2 ページ目へ送る)', () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(PAGED_HOOK_TIMEOUT_MS)
    const page = await newLoggedInPage(browser)
    // 古い順に作る (一覧は更新の新しい順なので、最初に作った 1 件が 2 ページ目に回る)
    for (const [i, note] of PAGED_NOTES.entries()) {
      await removeE2eNote(page, note)
      await page.goto(`/edit/${note.id}`)
      const save = page.getByRole('button', { name: '更新', exact: true })
      await expect(save).toBeVisible()
      await clearEditor(page)
      await memoEditor(page).click()
      await page.keyboard.insertText(`${note.heading}\n![](${IMAGES_PATH}/${pagedImage(i)})\n`)
      await save.click()
      await expect(page).toHaveURL((url) => url.pathname === `/item/${note.id}`)
    }
    await closePage(page)
  })

  test.afterAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(PAGED_HOOK_TIMEOUT_MS)
    const page = await newLoggedInPage(browser)
    for (const note of PAGED_NOTES) {
      await removeE2eNote(page, note)
    }
    await closePage(page)
  })

  test('3 ペインで → を押し続けると、次のページを読み込んで 21 枚目へ送る', async ({ page }) => {
    // Arrange
    const png = solidPng(64, 64, [40, 160, 40])
    await page.context().route(
      (url) => url.pathname.startsWith(`${IMAGES_PATH}/00000000-0000-4000-8000-000000000`),
      (route) => route.fulfill({ contentType: 'image/png', body: png }),
    )
    await page.context().addCookies([
      { name: 'view', value: 'image', url: BASE_URL },
      { name: 'panes', value: '3', url: BASE_URL },
    ])
    await openSearch(page, PAGED_TOKEN)
    const openers = searchResults(page).getByRole('button', { name: '画像を大きく表示' })
    await expect(openers).toHaveCount(PAGED_COUNT - 1)
    await expectHydrated(openers.first())
    await openers.first().click()
    const image = viewerImage(page.getByRole('region', { name: '画像の表示' }))
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${pagedImage(PAGED_COUNT - 1)}`)

    // Act: 1 ページ目の末尾まで送り、さらにもう 1 回
    for (let n = 1; n < PAGED_COUNT; n += 1) {
      await page.keyboard.press('ArrowRight')
      await expect(image).toHaveAttribute(
        'src',
        `${IMAGES_PATH}/${pagedImage(PAGED_COUNT - 1 - n)}`,
      )
      // 先読み: 残り 10 枚になった所で 2 ページ目を頼むので、1 ページ目の
      // 末尾 (20 枚目) よりずっと手前 (残り 8 枚) で一覧が伸びている
      if (n === PAGED_COUNT - 9) {
        await expect(openers).toHaveCount(PAGED_COUNT)
      }
    }

    // Assert: 2 ページ目の 1 枚 (最初に作ったノート) まで届き、一覧も伸びている
    await expect(image).toHaveAttribute('src', `${IMAGES_PATH}/${pagedImage(0)}`)
    await expect(openers).toHaveCount(PAGED_COUNT)
  })

  test('一覧は末尾が見える前 (1 画面ぶん手前) で次のページを読み込む', async ({ page }) => {
    // Arrange: 2 列ほどに狭めて、1 ページ目を器の 1 画面より十分長くする
    await page.setViewportSize({ width: 700, height: 800 })
    await page.context().addCookies([
      { name: 'view', value: 'image', url: BASE_URL },
      { name: 'panes', value: '3', url: BASE_URL },
    ])
    await openSearch(page, PAGED_TOKEN)
    const openers = searchResults(page).getByRole('button', { name: '画像を大きく表示' })
    await expect(openers).toHaveCount(PAGED_COUNT - 1)
    const scroller = page.locator('[data-results-scroll]')
    const loadMore = page.locator('[data-auto-load-more]')
    await expect(loadMore).toBeAttached()

    // Act: 末尾の目印が器の下端より半画面ぶん下に隠れる所までスクロール
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight - el.clientHeight * 1.5
    })

    // Assert: 目印は見えていないが、2 ページ目が届いている
    await expect(openers).toHaveCount(PAGED_COUNT)
  })
})

// スライドショーの動画 (docs/117 §8)。画像表示に動画のタイルが並び、
// ビューアで自動再生し、スライドショーは再生し終えたら次へ送る。
// 動画は 1.5 秒の webm (e2e/fixtures/slideshow-clip.webm)。保存規則どおり .mkv の
// 名前で video/webm として配る。?thumb=1 (poster) には PNG を返す
const VIDEO_NOTE = e2eNote(13, `slideshow video ${Date.now()}`)
const CLIP = '00000000-0000-4000-8000-0000000000b3.mkv'
const VIDEO_BODY = [
  VIDEO_NOTE.heading,
  `![](${IMAGES_PATH}/${TALL})`,
  `![録画](${IMAGES_PATH}/${CLIP})`,
  `![](${IMAGES_PATH}/${WIDE})`,
  '',
].join('\n')

async function serveVideo(context: BrowserContext): Promise<void> {
  const clip = readFileSync(path.join(__dirname, 'fixtures', 'slideshow-clip.webm'))
  const poster = solidPng(160, 120, [40, 160, 40])
  await context.route(
    (url) => url.pathname === `${IMAGES_PATH}/${CLIP}`,
    async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.has('thumb')) {
        await route.fulfill({ contentType: 'image/png', body: poster })
        return
      }
      await route.fulfill({ contentType: 'video/webm', body: clip })
    },
  )
}

function viewerVideo(scope: Page | Locator): Locator {
  return scope.locator('video[aria-label="ノートの動画"]')
}

test.describe('検索結果のスライドショー (動画)', () => {
  test.beforeEach(async ({ browser, page }) => {
    await page.addInitScript((key) => {
      // 間隔は最長の 10 秒。動画 (1.5 秒) がそれより早く送られれば、
      // 間隔ではなく再生の終わりで送ったと判る
      window.localStorage.setItem(key, '10')
    }, SLIDESHOW_INTERVAL_KEY)
    const setup = await newLoggedInPage(browser)
    await removeE2eNote(setup, VIDEO_NOTE)
    await setup.goto(`/edit/${VIDEO_NOTE.id}`)
    const save = setup.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(setup)
    await memoEditor(setup).click()
    await setup.keyboard.insertText(VIDEO_BODY)
    await save.click()
    await expect(setup).toHaveURL((url) => url.pathname === `/item/${VIDEO_NOTE.id}`)
    await closePage(setup)
  })

  test.afterEach(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, VIDEO_NOTE)
    await closePage(page)
  })

  async function openVideoResults(page: Page, panes: '1' | '3') {
    await serveImages(page.context())
    await serveVideo(page.context())
    await page.context().addCookies([
      { name: 'view', value: 'image', url: BASE_URL },
      { name: 'panes', value: panes, url: BASE_URL },
    ])
    await openSearch(page, VIDEO_NOTE.key)
    const videoTile = searchResults(page).getByRole('button', { name: '動画を再生' })
    await expect(videoTile).toBeVisible()
    await expectHydrated(videoTile)
    return videoTile
  }

  test('画像表示に動画のタイルが並び、押すとペインで自動再生する', async ({ page }) => {
    // Arrange
    const videoTile = await openVideoResults(page, '3')
    // 画像 2 + 動画 1 が本文の順に並ぶ
    await expect(
      searchResults(page).getByRole('button', { name: /^(画像を大きく表示|動画を再生)$/ }),
    ).toHaveCount(3)

    // Act
    await videoTile.click()

    // Assert: ペインに動画が出て、押さなくても再生が進む
    const pane = page.getByRole('region', { name: '画像の表示' })
    const video = viewerVideo(pane)
    await expect(video).toHaveAttribute('src', `${IMAGES_PATH}/${CLIP}`)
    await expect
      .poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime))
      .toBeGreaterThan(0)
  })

  test('画像表示の動画タイルは触らなくても動くサムネで、▶ は出さない', async ({
    page,
  }) => {
    // Arrange / Act: 開くだけ (ホバーもスクロールもしない)
    const videoTile = await openVideoResults(page, '3')
    await page.mouse.move(0, 0)

    // Assert: <img> は動くサムネ (アニメ WebP) の URL
    const poster = videoTile.locator('img')
    await expect(poster).toHaveAttribute('src', /thumb=1&anim=1/)
    // 動いていれば動画だと判るので ▶ は出さない (2026-10-28 指示)
    await expect(videoTile.locator('svg')).toHaveCount(0)
  })

  test('動くサムネが未生成 (404) の動画は、静止サムネに戻る', async ({ page }) => {
    // Arrange: 動くサムネだけ 404 にする (既存の動画の多くはまだ作られていない)。
    // route は後から登録したものが先に効くので、動画の配信の後に足す
    await serveImages(page.context())
    await serveVideo(page.context())
    await page.context().route(
      (url) => url.pathname === `${IMAGES_PATH}/${CLIP}` && url.searchParams.has('anim'),
      (route) => route.fulfill({ status: 404, body: '' }),
    )
    await page.context().addCookies([
      { name: 'view', value: 'image', url: BASE_URL },
      { name: 'panes', value: '3', url: BASE_URL },
    ])

    // Act
    await openSearch(page, VIDEO_NOTE.key)
    const videoTile = searchResults(page).getByRole('button', { name: '動画を再生' })
    await expect(videoTile).toBeVisible()

    // Assert: 壊れた画像にならず、静止サムネを出す
    const poster = videoTile.locator('img')
    await expect(poster).toHaveAttribute('src', /thumb=1&v=/)
    await expect(poster).not.toHaveAttribute('src', /anim=1/)
    await expect
      .poll(() => poster.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
    // 止まった絵では動画だと判らないので、このときだけ ▶ を出す。小さめの 32px
    const badge = videoTile.locator('svg')
    await expect(badge).toBeVisible()
    const badgeBox = await badge.boundingBox()
    expect(badgeBox?.width ?? 0).toBeLessThanOrEqual(33)
  })

  // 行の表示 (中・大) の顔を動画にしたノートで開く
  async function openVideoRows(page: Page, view: 'medium' | 'card') {
    await serveImages(page.context())
    await serveVideo(page.context())
    const setup = await newLoggedInPage(page.context().browser()!)
    await setup.goto(`/edit/${VIDEO_NOTE.id}`)
    const save = setup.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(setup)
    await memoEditor(setup).click()
    await setup.keyboard.insertText(`${VIDEO_NOTE.heading}\n![録画](${IMAGES_PATH}/${CLIP})\n`)
    await save.click()
    await expect(setup).toHaveURL((url) => url.pathname === `/item/${VIDEO_NOTE.id}`)
    await closePage(setup)
    await page.context().addCookies([
      { name: 'view', value: view, url: BASE_URL },
      { name: 'panes', value: '3', url: BASE_URL },
    ])
    await openSearch(page, VIDEO_NOTE.key)
    // 印 (data-row-thumb) に頼らず poster で引く — 印が無いときも重なりで落ちるように
    const thumb = searchResults(page).locator(`img[src^="${IMAGES_PATH}/${CLIP}?thumb=1"]`).first()
    await expect(thumb).toBeVisible()
    return thumb
  }

  for (const view of ['medium', 'card'] as const) {
    test(`${view} 表示でホバーしても、ゴミ箱の釦は動画のサムネに重ならない`, async ({ page }) => {
      // Arrange
      const thumb = await openVideoRows(page, view)

      // Act
      await thumb.hover()

      // Assert: ゴミ箱の釦はサムネの左に出て、重ならない
      const trash = searchResults(page).getByRole('button', { name: /ゴミ箱へ移動$/ })
      await expect(trash).toBeVisible()
      const thumbBox = await thumb.boundingBox()
      const trashBox = await trash.boundingBox()
      if (!thumbBox || !trashBox) throw new Error('サムネか釦が見つからない')
      expect(trashBox.x + trashBox.width).toBeLessThanOrEqual(thumbBox.x)
    })
  }

  test('大表示の行の動画のサムネを押すと、ノートではなくビューアで再生する', async ({ page }) => {
    // Arrange
    const thumb = await openVideoRows(page, 'card')
    await expectHydrated(searchResults(page).getByRole('button', { name: '動画を再生' }))

    // Act
    await thumb.click()

    // Assert: ノートのペインの場所に動画が出て再生が進む。ノートは開かない
    const pane = page.getByRole('region', { name: '画像の表示' })
    const video = viewerVideo(pane)
    await expect(video).toHaveAttribute('src', `${IMAGES_PATH}/${CLIP}`)
    await expect
      .poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime))
      .toBeGreaterThan(0)
    await expect(page).toHaveURL((url) => url.pathname === '/')
    // ▶ でスライドショーにできる
    await expect(pane.getByRole('button', { name: 'スライドショー', exact: true })).toBeVisible()
  })

  // iOS Safari の自動再生の規則を模す: 利用者の操作 (クリック・キー入力) の処理の
  // 中で play() / load() された要素だけが、以後は時計からでも再生できる (低電力
  // モードでは消音でも同じ)。navigator.userActivation はテスト用の Chromium では
  // 10 秒たっても切れず、模すのに使えなかった。
  // 動画ごとに要素を作っていた頃は、時計で送った先の動画が拒まれて飛ばされた
  // (2026-10-28 報告)。ビューアは 1 つの要素を使い回し、押した瞬間に許可を取る
  test('Safari の規則でも、時計で送った先の動画が再生される', async ({ page }) => {
    // Arrange
    await page.addInitScript(() => {
      // 「操作の中」= クリック・キー入力の処理の最中。処理が終わったら切る
      let inGesture = false
      for (const type of ['click', 'keydown', 'pointerup']) {
        window.addEventListener(type, () => {
          inGesture = true
          setTimeout(() => {
            inGesture = false
          }, 0)
        }, true)
      }
      const unlocked = new WeakSet<HTMLMediaElement>()
      const play = HTMLMediaElement.prototype.play
      const load = HTMLMediaElement.prototype.load
      HTMLMediaElement.prototype.load = function (this: HTMLMediaElement) {
        if (inGesture) unlocked.add(this)
        return load.call(this)
      }
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        if (inGesture) unlocked.add(this)
        if (!unlocked.has(this)) {
          return Promise.reject(new DOMException('blocked', 'NotAllowedError'))
        }
        return play.call(this)
      }
    })
    await openVideoResults(page, '1')

    // Act: 一覧の「スライドショー」(先頭の画像から。動画には 10 秒後に時計で送られる)
    await searchResults(page).getByRole('button', { name: 'スライドショー', exact: true }).click()

    // Assert: 時計で送った先の動画が流れる (拒まれて「タップで再生」にならない)
    const video = viewerVideo(page)
    await expect(video).toHaveAttribute('src', `${IMAGES_PATH}/${CLIP}`, {
      timeout: 15_000,
    })
    await expect
      .poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime))
      .toBeGreaterThan(0)
    await expect(page.getByText('タップで再生')).toHaveCount(0)
  })

  test('自動再生をすべて拒まれても動画を飛ばさず、「タップで再生」で待つ', async ({ page }) => {
    // Arrange: どの再生も拒む (許可の取れない端末)。間隔は最短の 3 秒
    await page.addInitScript((key) => {
      window.localStorage.setItem(key, '3')
      HTMLMediaElement.prototype.play = () =>
        Promise.reject(new DOMException('blocked', 'NotAllowedError'))
    }, SLIDESHOW_INTERVAL_KEY)
    const videoTile = await openVideoResults(page, '1')
    await videoTile.click()
    const video = viewerVideo(page)
    await expect(video).toHaveAttribute('src', `${IMAGES_PATH}/${CLIP}`)

    // Act: その動画からスライドショーを始める
    await page
      .locator('[data-image-viewer]')
      .getByRole('button', { name: 'スライドショー', exact: true })
      .click()

    // Assert: 「タップで再生」と出し、間隔 (3 秒) も「始まらない」の見切り
    // (15 秒) も過ぎても次へ送らない
    await expect(page.getByText('タップで再生')).toBeVisible()
    await page.waitForTimeout(16_000)
    await expect(video).toHaveAttribute('src', `${IMAGES_PATH}/${CLIP}`)
    await expect(page.getByText('タップで再生')).toBeVisible()
  })

  test('スライドショーは動画を最後まで再生したら、間隔を待たずに次の画像へ送る', async ({
    page,
  }) => {
    // Arrange: 動画をペインで開く
    const videoTile = await openVideoResults(page, '3')
    await videoTile.click()
    const pane = page.getByRole('region', { name: '画像の表示' })
    await expect(viewerVideo(pane)).toBeVisible()

    // Act: ペインの ▶ (全画面の覆いで、動画の頭から流れる)
    await pane.getByRole('button', { name: 'スライドショー', exact: true }).click()

    // Assert: 覆いで動画が自動で再生される
    await expect(pane).toHaveCount(0)
    const video = viewerVideo(page)
    await expect(video).toHaveAttribute('src', `${IMAGES_PATH}/${CLIP}`)
    await expect
      .poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime))
      .toBeGreaterThan(0)
    const startedAt = Date.now()

    // Assert: 再生し終えたら (1.5 秒 + 間 0.8 秒)、間隔の 10 秒を待たずに次の画像へ
    await expect(viewerImage(page)).toHaveAttribute('src', `${IMAGES_PATH}/${WIDE}`, {
      timeout: SLIDE_WAIT_MS,
    })
    expect(Date.now() - startedAt).toBeLessThan(8_000)
  })
})
