import type { BrowserContext, Locator, Page } from '@playwright/test'
import {
  activateLayer,
  canvasHash,
  canvasSize,
  changedHash,
  chooseTool,
  drag,
  drawButton,
  drawDialog,
  expectHash,
  expectHashStays,
  layerRowText,
  lowerCanvas,
  MAX_STRAY_PIXELS,
  rememberPixels,
  settledHash,
  strayPixels,
  tap,
  toggleLayer,
  touchStroke,
  waitForHistory,
  withLayerPanel,
} from './drawCanvas'
import { E2E_ITEM_PREFIX } from './env'
import {
  clearEditor,
  closePage,
  expect,
  expectHydrated,
  newLoggedInPage,
  newTouchPage,
  test,
} from './helpers'
import { formFilePart, type ImageInfo, readImageInfo, solidPng } from './imageBytes'
import { removeE2eNote } from './notes'

// お絵かき画面 (components/draw/) の操作を順に通す (docs/96 §3-3)。
// 前の段が描いた絵に次の段が描き足すので、1 枚のページを直列で使い回す。
//
// - **DB には書かない。** `/api/images` への送信は route で偽の封筒を返し、
//   下敷きの画像も route で配る。書くのはノート 1 件の普通の保存だけで、
//   それも afterAll が UI から永久削除する
// - **画素は同じ実行の中の前後比較で見る。** 黄金ファイルは持たない
//   (Chromium の版で描画の画素がずれる)。書き出しは送信本文の PNG / WebP
//   ヘッダから寸法と形式を読む
const ITEM_NO = `${E2E_ITEM_PREFIX}4`
const BODY = `${E2E_ITEM_PREFIX} draw ${Date.now()}`

// 横取りで配る画像の名前 (実在しない UUID)。アップロードの URL は連番を足す
const UPLOAD_ID_HEAD = 'e2e0d4a1-0000-4000-8000-00000000010'
const BACKGROUND_NAME = 'e2e0d4a1-0000-4000-8000-000000000201.png'
const MISSING_NAME = 'e2e0d4a1-0000-4000-8000-000000000404.png'
const BACKGROUND_SIZE = { width: 800, height: 600 }
const BACKGROUND_RGB = [120, 160, 220] as const
const IMAGES_PATH = '/api/images'

// 白紙の器の長辺 (lib/draw/drawingFile.ts の BLANK_LONG_EDGE)
const BLANK_LONG_EDGE = 1600

const CLOSE_CONFIRM = '描いたものは保存されません。閉じますか？'
const BACKGROUND_FAILED = '背景にする画像を読み込めませんでした。白紙で描けます。'

// ------------------------------------------------------------------------
// 画像の横取り

interface Upload extends ImageInfo {
  url: string
  contentType: string
  bytes: Buffer
}

const uploads: Upload[] = []

function extensionOf(info: ImageInfo): string {
  return info.mime === 'image/webp' ? 'webp' : 'png'
}

// `/api/images` の送信は受け取って偽の URL を返し、読み出しは手元の
// バイト列で答える。知らない名前の読み出しだけ素通しする (本物のノートの
// 画像を出すことはあっても、書き込みはサーバへ届けない)
async function interceptImages(context: BrowserContext): Promise<void> {
  const background = solidPng(BACKGROUND_SIZE.width, BACKGROUND_SIZE.height, BACKGROUND_RGB)
  await context.route(
    (url) => url.pathname === IMAGES_PATH || url.pathname.startsWith(`${IMAGES_PATH}/`),
    async (route) => {
      const request = route.request()
      const { pathname } = new URL(request.url())
      if (request.method() !== 'GET') {
        if (pathname !== IMAGES_PATH || request.method() !== 'POST') {
          await route.abort()
          return
        }
        const part = formFilePart(
          request.postDataBuffer() ?? Buffer.alloc(0),
          (await request.headerValue('content-type')) ?? '',
          'file',
        )
        const info = readImageInfo(part.bytes)
        const url = `${IMAGES_PATH}/${UPLOAD_ID_HEAD}${uploads.length}.${extensionOf(info)}`
        uploads.push({ ...info, url, contentType: part.contentType, bytes: part.bytes })
        await route.fulfill({ json: { success: true, data: { url }, error: null } })
        return
      }
      const uploaded = uploads.find((upload) => upload.url === pathname)
      if (uploaded) {
        await route.fulfill({ contentType: uploaded.mime, body: uploaded.bytes })
      } else if (pathname === `${IMAGES_PATH}/${BACKGROUND_NAME}`) {
        await route.fulfill({ contentType: 'image/png', body: background })
      } else if (pathname === `${IMAGES_PATH}/${MISSING_NAME}`) {
        await route.fulfill({ status: 404, json: { success: false, data: null, error: 'Not Found' } })
      } else {
        await route.fallback()
      }
    },
  )
}

// ------------------------------------------------------------------------
// 画面の部品

function saveButton(page: Page): Locator {
  return page.getByRole('button', { name: '更新', exact: true })
}

function memoField(page: Page): Locator {
  return page.locator('input[name="memo"]')
}

async function openEditor(page: Page): Promise<void> {
  await page.goto(`/edit/${ITEM_NO}`)
  // 「更新」は下部バーへ portal され、マウント後にしか現れない
  await expect(saveButton(page)).toBeVisible()
}

async function openDrawing(page: Page): Promise<void> {
  const open = page.getByRole('button', { name: 'お絵かき', exact: true })
  await expectHydrated(open)
  await open.click()
  await expect(drawDialog(page)).toBeVisible()
  // 準備中 (下敷きの読み込み・fabric の作成) は道具が押せない。
  // 押せるようになれば canvas も出来ている
  await expect(drawButton(page, 'ペン')).toBeEnabled()
  await expect(lowerCanvas(page)).toBeVisible()
}

// 本文を丸ごと差し替える。insertText は 1 回の入力なので括弧の自動補完が挟まらない
async function replaceBody(page: Page, text: string): Promise<void> {
  await clearEditor(page)
  await page.keyboard.insertText(text)
  await expect(memoField(page)).toHaveValue(text)
}

// ------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' })

test.describe('お絵かき', () => {
  let page: Page
  // confirm は応答を切り替えられる 1 本のリスナで受け、文面を控える
  const dialogs: string[] = []
  let acceptDialogs = false
  // 段をまたいで比べるハッシュ
  let blank = ''
  let penStroke = ''

  test.beforeAll(async ({ browser }) => {
    page = await newLoggedInPage(browser)
    // 前の回が途中で落ちて残した同じ番号を消しておく (無ければ何もしない)
    await removeE2eNote(page, ITEM_NO)
    await interceptImages(page.context())
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message())
      void (acceptDialogs ? dialog.accept() : dialog.dismiss())
    })
  })

  test.afterAll(async ({ browser }) => {
    if (page !== undefined) {
      await closePage(page)
    }
    // 途中で落ちても本物の DB に残さない
    const cleanup = await newLoggedInPage(browser)
    await removeE2eNote(cleanup, ITEM_NO)
    await closePage(cleanup)
  })

  test('編集画面から開くと、白紙・ペン・戻せない状態で始まる', async () => {
    // Arrange: 番号を /edit で決めて普通に保存する (note-lifecycle と同じ作り方)
    await openEditor(page)
    await replaceBody(page, BODY)
    await saveButton(page).click()
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_NO}`)
    await openEditor(page)

    // Act
    await openDrawing(page)

    // Assert
    await expect(drawButton(page, 'ペン')).toHaveAttribute('aria-pressed', 'true')
    await expect(drawButton(page, 'マーカー')).toHaveAttribute('aria-pressed', 'false')
    await expect(drawButton(page, '元に戻す')).toBeDisabled()
    await expect(drawButton(page, 'やり直す')).toBeDisabled()
    await expect(drawButton(page, '本文に挿入')).toBeDisabled()
    await expect(drawButton(page, 'レイヤ 1')).toBeVisible()
    const size = await canvasSize(page)
    expect(Math.max(size.width, size.height)).toBe(BLANK_LONG_EDGE)
    blank = await settledHash(page)
  })

  test('ペンで描くと画素が変わり、元に戻す・やり直すで行き来する', async () => {
    // Act
    await drag(page, { x: 0.2, y: 0.3 }, { x: 0.8, y: 0.35 })

    // Assert
    penStroke = await changedHash(page, blank)
    await expect(drawButton(page, '元に戻す')).toBeEnabled()
    await expect(drawButton(page, '本文に挿入')).toBeEnabled()

    await drawButton(page, '元に戻す').click()
    await expectHash(page, blank)
    await expect(drawButton(page, 'やり直す')).toBeEnabled()
    await expect(drawButton(page, '本文に挿入')).toBeDisabled()

    await drawButton(page, 'やり直す').click()
    await expectHash(page, penStroke)
    await expect(drawButton(page, 'やり直す')).toBeDisabled()
  })

  test('色と太さを変えると、同じ線でも違う画素になる', async () => {
    // Arrange: 白紙に戻す
    await drawButton(page, '元に戻す').click()
    await expectHash(page, blank)

    // Act
    await drawDialog(page).getByLabel('色', { exact: true }).fill('#0000ff')
    await drawDialog(page).getByLabel('太さ', { exact: true }).selectOption('24')
    await drag(page, { x: 0.2, y: 0.3 }, { x: 0.8, y: 0.35 })

    // Assert
    const restyled = await changedHash(page, blank)
    expect(restyled).not.toBe(penStroke)
    // 描き直したので、やり直す先は捨てられている
    await expect(drawButton(page, 'やり直す')).toBeDisabled()
  })

  test('マーカーは線を足し、消しゴムは線を消す', async () => {
    // Arrange
    await chooseTool(page, 'マーカー')
    const before = await canvasHash(page)

    // Act: マーカー
    await drag(page, { x: 0.2, y: 0.15 }, { x: 0.6, y: 0.2 })

    // Assert
    const marked = await changedHash(page, before)

    // Act: 消しゴムでペンの線を縦に横切る
    await chooseTool(page, '消しゴム')
    await expect(drawDialog(page).getByLabel('色', { exact: true })).toBeDisabled()
    await drag(page, { x: 0.5, y: 0.22 }, { x: 0.5, y: 0.45 })

    // Assert
    await changedHash(page, marked)
  })

  test('文字は空のまま抜けると消え、打てば残る', async () => {
    // Arrange
    await chooseTool(page, '文字')
    const before = await canvasHash(page)
    const countBefore = await layerRowText(page, 1)
    const focusedTag = () => page.evaluate(() => document.activeElement?.tagName)

    // Act: 置いて何も打たずに Esc で抜ける
    await tap(page, { x: 0.1, y: 0.85 })
    await expect.poll(focusedTag).toBe('TEXTAREA')
    await page.keyboard.press('Escape')

    // Assert: 入力を終えただけで画面は閉じず (確認も出ない)、空の文字は残らない
    await expect.poll(focusedTag).not.toBe('TEXTAREA')
    await expectHashStays(page, before)
    await expect(drawDialog(page)).toBeVisible()
    expect(dialogs).toEqual([])
    expect(await layerRowText(page, 1)).toBe(countBefore)

    // Act: 置いて打ち、Esc で入力を終える。
    // 先に打つと、確定した文字が選択から外れたときに描き直されて画素がずれ、
    // 「空なら変わらない」を比べられない
    await tap(page, { x: 0.1, y: 0.55 })
    await expect.poll(focusedTag).toBe('TEXTAREA')
    await page.keyboard.type('E2E')
    await page.keyboard.press('Escape')

    // Assert
    await changedHash(page, before)
    await expect(drawDialog(page)).toBeVisible()
    expect(dialogs).toEqual([])
    // 件数は履歴に積むとき (150ms まとめた後) に数え直される
    await expect.poll(() => layerRowText(page, 1)).not.toBe(countBefore)
  })

  test('四角・矢印・丸はドラッグで置け、タップだけでは何も置かない', async () => {
    const shapes = [
      { tool: '四角', from: { x: 0.25, y: 0.6 }, to: { x: 0.4, y: 0.8 } },
      { tool: '矢印', from: { x: 0.45, y: 0.8 }, to: { x: 0.6, y: 0.6 } },
      { tool: '丸', from: { x: 0.65, y: 0.6 }, to: { x: 0.8, y: 0.8 } },
    ]
    for (const shape of shapes) {
      // Arrange
      await chooseTool(page, shape.tool)
      const before = await canvasHash(page)

      // Act
      await drag(page, shape.from, shape.to)

      // Assert
      await changedHash(page, before)
    }

    // Act: 動かさずに押して離す
    const beforeTap = await canvasHash(page)
    await tap(page, { x: 0.9, y: 0.9 })

    // Assert
    await expectHashStays(page, beforeTap)
  })

  test('塗るは押した所から塗り、モザイクは囲んだ所を均す', async () => {
    // Arrange: 塗りの色は線と違う色にする (同じ色だと上の段の線が塗りに埋もれる)
    await chooseTool(page, '塗る')
    await drawDialog(page).getByLabel('色', { exact: true }).fill('#00cc00')
    const before = await canvasHash(page)

    // Act: 何も無い隅を押す
    await tap(page, { x: 0.95, y: 0.1 })

    // Assert
    const filled = await changedHash(page, before)

    // Act: 線と図形にかかる範囲を囲む
    await chooseTool(page, 'モザイク')
    await drag(page, { x: 0.15, y: 0.1 }, { x: 0.45, y: 0.4 })

    // Assert
    await changedHash(page, filled)
  })

  test('選択で掴んで動かすと画素が変わる', async () => {
    // Arrange
    await chooseTool(page, '選択')
    const before = await canvasHash(page)

    // Act: 四角のあたりを掴んで動かす (一番手前のオブジェクトが動く)
    await drag(page, { x: 0.3, y: 0.7 }, { x: 0.35, y: 0.9 })

    // Assert
    await changedHash(page, before)
    await expect(drawButton(page, '元に戻す')).toBeEnabled()
  })

  test('拡大・縮小・全体表示で表示の倍率だけが変わる', async () => {
    // Arrange
    const reset = drawButton(page, '全体を表示')
    const zoomIn = drawButton(page, '拡大')
    const zoomOut = drawButton(page, '縮小')
    const shownWidth = async () => (await lowerCanvas(page).boundingBox())?.width ?? 0
    // 前の段は「選択」で掴んだまま終わる。描き直しが落ち着く前に基準を取ると、
    // 読む時機しだいで最後の比較が 1 回だけ落ちた (一式で流して 6 回に 1 回)
    const before = await settledHash(page)
    const fitWidth = await shownWidth()
    await expect(reset).toHaveText('100%')
    await expect(reset).toBeDisabled()
    await expect(zoomOut).toBeDisabled()

    // Act / Assert: 拡大 1 回で 1.5 倍
    await zoomIn.click()
    await expect(reset).toHaveText('150%')
    await expect(zoomOut).toBeEnabled()
    await expect.poll(shownWidth).toBeCloseTo(fitWidth * 1.5, 0)

    // 縮小で戻る
    await zoomOut.click()
    await expect(reset).toHaveText('100%')
    await expect.poll(shownWidth).toBeCloseTo(fitWidth, 0)

    // 2 回拡大してから全体表示で戻る
    await zoomIn.click()
    await zoomIn.click()
    await expect(reset).toHaveText('225%')
    await reset.click()
    await expect(reset).toHaveText('100%')
    await expect.poll(shownWidth).toBeCloseTo(fitWidth, 0)

    // 拡大は虫めがね。描いた絵は変わらない (倍率を戻した後の描き直しを待って比べる)
    await expectHash(page, before)
  })

  test('2 本目の指が着いたら、描きかけの線を残さない (タッチ)', async ({ browser }) => {
    const touch = await newTouchPage(browser)
    try {
      // Arrange
      await openEditor(touch)
      await openDrawing(touch)
      const touchBlank = await settledHash(touch)

      // Act
      await touchStroke(touch, true)

      // Assert
      await expectHashStays(touch, touchBlank)
      await expect(drawButton(touch, '元に戻す')).toBeDisabled()

      // 対照: 2 本目が無ければ同じ指の動きで線が残る (イベントが届いている証拠)
      await touchStroke(touch, false)
      await changedHash(touch, touchBlank)
      await expect(drawButton(touch, '元に戻す')).toBeEnabled()
    } finally {
      await closePage(touch)
    }
  })

  test('レイヤを切り替えて描き、隠す・見せる・そのレイヤだけ消せる', async () => {
    // Arrange: レイヤ 2 に切り替える
    await chooseTool(page, 'ペン')
    const layer1Only = await settledHash(page)
    await withLayerPanel(page, (menu) => activateLayer(menu, 2))
    await expect(drawButton(page, 'レイヤ 2')).toBeVisible()

    // Act: レイヤ 2 に線を引く
    await drag(page, { x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 })

    // Assert
    const both = await changedHash(page, layer1Only)

    // Act / Assert: レイヤ 1 を隠すと絵が変わり、見せると戻る
    await withLayerPanel(page, async (menu) => {
      await toggleLayer(menu, 'レイヤ 1 を非表示')
      await changedHash(page, both)
      await toggleLayer(menu, 'レイヤ 1 を表示')
      await expectHash(page, both)
    })

    // Act: 消しゴムで両方のレイヤの線を横切る
    await chooseTool(page, '消しゴム')
    await drag(page, { x: 0.5, y: 0.3 }, { x: 0.5, y: 0.7 })

    // Assert: 絵は変わるが、レイヤ 1 だけを見ると描く前と同じ
    const erased = await changedHash(page, both)
    await withLayerPanel(page, async (menu) => {
      await activateLayer(menu, 1)
      await toggleLayer(menu, 'レイヤ 2 を非表示')
      await expectHash(page, layer1Only)
      await toggleLayer(menu, 'レイヤ 2 を表示')
      await expectHash(page, erased)
    })
  })

  test('全消しで白紙になり、元に戻すで戻る', async () => {
    // Arrange
    await settledHash(page)
    await rememberPixels(page, 'beforeClear')
    await waitForHistory(page)

    // Act
    await drawButton(page, '全消し').click()

    // Assert
    await expectHash(page, blank)
    await expect(drawButton(page, '本文に挿入')).toBeDisabled()

    await drawButton(page, '元に戻す').click()
    await changedHash(page, blank)
    expect(await strayPixels(page, 'beforeClear')).toBeLessThanOrEqual(MAX_STRAY_PIXELS)
    await expect(drawButton(page, '本文に挿入')).toBeEnabled()
  })

  test('レイヤを隠したまま挿入すると、器の寸法の画像が送られ本文に入る', async () => {
    // Arrange
    await withLayerPanel(page, (menu) => toggleLayer(menu, 'レイヤ 2 を非表示'))
    const size = await canvasSize(page)
    const sent = uploads.length

    // Act
    await drawButton(page, '本文に挿入').click()

    // Assert
    await expect(drawDialog(page)).toBeHidden()
    expect(uploads).toHaveLength(sent + 1)
    const upload = uploads[sent]
    // Chromium は WebP を書き出せるので、PNG への落とし (encodeDrawing) は通らない
    expect(upload.mime).toBe('image/webp')
    expect(upload.contentType).toBe(upload.mime)
    expect({ width: upload.width, height: upload.height }).toEqual(size)
    // 挿入はカーソルの位置 (開き直した直後は先頭) に入る。本文は残る
    await expect.poll(() => memoField(page).inputValue()).toContain(`](${upload.url})`)
    await expect(memoField(page)).toHaveValue(new RegExp(BODY))
  })

  test('描いてから閉じると確認が出て、空なら Esc で黙って閉じる', async () => {
    // Arrange: 本文に今の絵があるので、それを下敷きにして開く
    await openDrawing(page)
    await expect(drawButton(page, '白紙にする')).toBeVisible()
    const upload = uploads[uploads.length - 1]
    expect(await canvasSize(page)).toEqual({ width: upload.width, height: upload.height })
    const background = await settledHash(page)
    await drag(page, { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 })
    await changedHash(page, background)
    dialogs.length = 0

    // Act / Assert: 断ると開いたまま
    await drawButton(page, '閉じる').click()
    await expect.poll(() => dialogs).toEqual([CLOSE_CONFIRM])
    await expect(drawDialog(page)).toBeVisible()

    // 受け入れると閉じる
    acceptDialogs = true
    try {
      await drawButton(page, '閉じる').click()
      await expect(drawDialog(page)).toBeHidden()
    } finally {
      acceptDialogs = false
    }
    await expect.poll(() => dialogs).toEqual([CLOSE_CONFIRM, CLOSE_CONFIRM])

    // 何も描いていなければ Esc で確認なしに閉じる
    await openDrawing(page)
    await page.keyboard.press('Escape')
    await expect(drawDialog(page)).toBeHidden()
    expect(dialogs).toHaveLength(2)
  })

  test('カーソルの近くの画像を下敷きにし、読めなければ白紙で描ける', async () => {
    // Arrange: 下敷きになる画像だけの本文
    await replaceBody(page, `![bg](${IMAGES_PATH}/${BACKGROUND_NAME})`)
    const sent = uploads.length

    // Act
    await openDrawing(page)

    // Assert: 下敷きの寸法の器 (小さい画像は伸ばさない) で、描いて挿入できる
    expect(await canvasSize(page)).toEqual(BACKGROUND_SIZE)
    await expect(drawDialog(page).getByText(BACKGROUND_FAILED)).toHaveCount(0)
    const background = await settledHash(page)
    await drag(page, { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 })
    await changedHash(page, background)
    await drawButton(page, '本文に挿入').click()
    await expect(drawDialog(page)).toBeHidden()
    expect(uploads).toHaveLength(sent + 1)
    expect({ width: uploads[sent].width, height: uploads[sent].height }).toEqual(BACKGROUND_SIZE)

    // Arrange: 読めない画像だけの本文
    await replaceBody(page, `![missing](${IMAGES_PATH}/${MISSING_NAME})`)

    // Act
    await openDrawing(page)

    // Assert: 知らせを出して白紙の器になり、そのまま描ける
    await expect(drawDialog(page).getByText(BACKGROUND_FAILED)).toBeVisible()
    const size = await canvasSize(page)
    expect(Math.max(size.width, size.height)).toBe(BLANK_LONG_EDGE)
    const failedBlank = await settledHash(page)
    expect(failedBlank).toBe(blank)
    await drag(page, { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 })
    await changedHash(page, failedBlank)

    acceptDialogs = true
    try {
      await drawButton(page, '閉じる').click()
      await expect(drawDialog(page)).toBeHidden()
    } finally {
      acceptDialogs = false
    }
  })

  test('本文を戻して保存し、編集画面を離れる', async () => {
    // Arrange: 偽の画像 URL は保存しない
    await replaceBody(page, BODY)

    // Act
    await saveButton(page).click()

    // Assert
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_NO}`)
    await expect(page.getByText(BODY).first()).toBeVisible()
  })
})
