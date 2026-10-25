import type { Page } from '@playwright/test'
import sharp from 'sharp'
import { BASE_URL } from './env'
import { mp4WithHandlers } from '../src/lib/uploads/sniff/__fixtures__/media'
import { closePage, expect, newLoggedInPage, test } from './helpers'

// メニューの「サーバへコピー」「サーバからペースト」
// (docs/114-サーバクリップボード計画.md §5 Phase 5)。
//
// OS のクリップボードを実際に書いて読む (chromium に clipboard-read / write を許す)。
// Windows の Chrome と同じ経路なので、文字と画像の往復と「消す」を通す。
// iOS の「ペースト」の吹き出しは再現できないので、iPhone 実機で確かめる
//
// 枠は利用者ごとに 1 行。E2E の利用者 (e2e) の行しか触らないので、本物のデータには
// 届かない。前の回の中身が残らないよう、前後で DELETE する

const TEXT = 'サーバクリップボードの E2E: 日本語 abc 😀'

async function openMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'メニュー', exact: true }).click()
  await expect(page.getByRole('button', { name: 'サーバへコピー' })).toBeVisible()
}

// 知らせは span。同じ role の他の要素 (引っ張って更新の案内・ルート読み上げ) と区別する
const statusNote = (page: Page) => page.locator('span[role="status"]')
const alertNote = (page: Page) => page.locator('span[role="alert"]')

async function clearSlotViaApi(page: Page): Promise<void> {
  const res = await page.request.delete('/api/clipboard')
  expect(res.ok()).toBe(true)
}

// 画像をクリップボードに載せる。canvas で描いた 8x8 の PNG
async function writeImageToClipboard(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const context = canvas.getContext('2d')
    if (context === null) {
      throw new Error('canvas 2d が取れません')
    }
    context.fillStyle = '#d33'
    context.fillRect(0, 0, 8, 8)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob')), 'image/png')),
    )
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  })
}

test.describe('サーバ経由のクリップボード', () => {
  let page: Page

  test.beforeEach(async ({ browser }) => {
    page = await newLoggedInPage(browser)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL })
    await page.goto('/')
    await clearSlotViaApi(page)
  })

  test.afterEach(async () => {
    await clearSlotViaApi(page)
    await closePage(page)
  })

  test('中身が無いときはペーストが押せず「なし」と出る', async () => {
    await openMenu(page)

    await expect(page.getByRole('button', { name: /サーバからペースト/ })).toBeDisabled()
    await expect(page.getByText('なし', { exact: true })).toBeVisible()
  })

  test('文字: 送って、別の文字で上書きした OS のクリップボードへ受け取れる', async () => {
    // Arrange
    await page.evaluate((text) => navigator.clipboard.writeText(text), TEXT)
    await openMenu(page)

    // Act: 送る
    await page.getByRole('button', { name: 'サーバへコピー' }).click()

    // Assert: 知らせと、ペースト行の予告
    await expect(statusNote(page)).toContainText('サーバへ送りました (文字 ')
    await expect(page.getByRole('button', { name: /サーバからペースト/ })).toContainText('いま')

    // Act: OS のクリップボードを別の物にしてから受け取る
    await page.evaluate(() => navigator.clipboard.writeText('別の文字'))
    await page.getByRole('button', { name: /サーバからペースト/ }).click()

    // Assert
    await expect(statusNote(page)).toContainText('クリップボードにコピーしました')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(TEXT)
  })

  test('画像: 送って、受け取ると image/png でクリップボードに載る', async () => {
    // Arrange
    await writeImageToClipboard(page)
    await openMenu(page)

    // Act
    await page.getByRole('button', { name: 'サーバへコピー' }).click()

    // Assert: サーバの枠に画像が入った
    await expect(statusNote(page)).toContainText('サーバへ送りました (画像 ')
    const stored = await page.request.get('/api/clipboard/data')
    expect(stored.status()).toBe(200)
    expect(stored.headers()['content-type']).toBe('image/png')
    expect(stored.headers()['cache-control']).toBe('no-store')

    // Act: 文字で上書きしてから受け取る
    await page.evaluate(() => navigator.clipboard.writeText('x'))
    await page.getByRole('button', { name: /サーバからペースト/ }).click()

    // Assert
    await expect(statusNote(page)).toContainText('クリップボードにコピーしました')
    const types = await page.evaluate(async () => {
      const items = await navigator.clipboard.read()
      return items.flatMap((item) => [...item.types])
    })
    expect(types).toContain('image/png')
  })

  test('「消す」で枠が空になり、ペーストが押せなくなる', async () => {
    await page.evaluate((text) => navigator.clipboard.writeText(text), TEXT)
    await openMenu(page)
    await page.getByRole('button', { name: 'サーバへコピー' }).click()
    await expect(statusNote(page)).toContainText('サーバへ送りました')

    await page.getByRole('button', { name: '消す', exact: true }).click()

    await expect(statusNote(page)).toContainText('消しました')
    await expect(page.getByRole('button', { name: /サーバからペースト/ })).toBeDisabled()
    const res = await page.request.get('/api/clipboard')
    expect((await res.json()).data.slot).toBeNull()
  })

  test('メニューを開き直すと、サーバの中身を読み直して予告を出す', async () => {
    await page.evaluate((text) => navigator.clipboard.writeText(text), TEXT)
    await openMenu(page)
    await page.getByRole('button', { name: 'サーバへコピー' }).click()
    await expect(statusNote(page)).toContainText('サーバへ送りました')

    await page.keyboard.press('Escape')
    await page.reload()
    await openMenu(page)

    await expect(page.getByRole('button', { name: /サーバからペースト/ })).toContainText('文字 ')
    await expect(page.getByRole('button', { name: /サーバからペースト/ })).toBeEnabled()
  })

  test('クリップボードに文字も画像も無いときは理由を出し、サーバは変わらない', async () => {
    // 空文字は text/plain として載らない環境があるので、空の ClipboardItem を直接作れない。
    // 代わりに「空の文字」を載せて断られることを見る
    await page.evaluate(() => navigator.clipboard.writeText(''))
    await openMenu(page)

    await page.getByRole('button', { name: 'サーバへコピー' }).click()

    await expect(alertNote(page)).toContainText(/クリップボード/)
    const res = await page.request.get('/api/clipboard')
    expect((await res.json()).data.slot).toBeNull()
  })

  // ファイルを選んで送る: 動画・PDF・テキストはクリップボードに載らないので「保存」になる
  test.describe('ファイルを選んで送る', () => {
    const fileInput = (p: Page) => p.locator('input[type="file"]')

    test('動画: 送ると「サーバから保存」になり、保存すると同じバイト列が落ちる', async () => {
      const mp4 = Buffer.from(mp4WithHandlers('isom', ['vide', 'soun']))
      await openMenu(page)

      await fileInput(page).setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: mp4 })

      await expect(statusNote(page)).toContainText('サーバへ送りました (動画 ')
      const save = page.getByRole('link', { name: /サーバから保存/ })
      await expect(save).toBeVisible()
      await expect(page.getByRole('button', { name: /サーバからペースト/ })).toHaveCount(0)
      const [download] = await Promise.all([page.waitForEvent('download'), save.click()])
      expect(download.suggestedFilename()).toMatch(/^clipboard-\d{8}-\d{6}\.mp4$/)
      const { createReadStream } = await import('node:fs')
      const chunks: Buffer[] = []
      for await (const chunk of createReadStream((await download.path()) ?? '')) {
        chunks.push(chunk as Buffer)
      }
      expect(Buffer.concat(chunks).equals(mp4)).toBe(true)
    })

    test('PDF とテキスト (日本語名の csv) も送れる', async () => {
      await openMenu(page)

      await fileInput(page).setInputFiles({
        name: 'doc.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\n%EOF'),
      })
      await expect(statusNote(page)).toContainText('サーバへ送りました (PDF ')

      await fileInput(page).setInputFiles({
        name: '成績 1.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('名前,点\nあ,90\n'),
      })
      await expect(statusNote(page)).toContainText('サーバへ送りました (テキストファイル ')
      const stored = await page.request.get('/api/clipboard/data')
      expect(stored.headers()['content-type']).toBe('text/csv; charset=utf-8')
    })

    // 写真は JPEG に揃う。TIFF はブラウザが読めないので変換される
    test('TIFF の写真は JPEG に変換されて置かれ、貼り付けも保存もできる', async () => {
      const tiff = await sharp({
        create: { width: 12, height: 8, channels: 3, background: '#cc3333' },
      })
        .tiff()
        .toBuffer()
      await openMenu(page)

      await fileInput(page).setInputFiles({ name: 'photo.tiff', mimeType: 'image/tiff', buffer: tiff })

      await expect(statusNote(page)).toContainText('サーバへ送りました (画像 ')
      const stored = await page.request.get('/api/clipboard/data')
      expect(stored.headers()['content-type']).toBe('image/jpeg')
      await expect(page.getByRole('link', { name: '保存', exact: true })).toBeVisible()

      await page.evaluate(() => navigator.clipboard.writeText('x'))
      await page.getByRole('button', { name: /サーバからペースト/ }).click()
      await expect(statusNote(page)).toContainText('クリップボードにコピーしました')
      const types = await page.evaluate(async () =>
        (await navigator.clipboard.read()).flatMap((item) => [...item.types]),
      )
      expect(types).toContain('image/png')
    })

    test('対応しない形式 (zip) は理由を出して置かない', async () => {
      await openMenu(page)

      await fileInput(page).setInputFiles({
        name: 'a.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0]),
      })

      await expect(alertNote(page)).toContainText('この形式のファイルは送れません')
      expect(((await (await page.request.get('/api/clipboard')).json()).data).slot).toBeNull()
    })
  })

  // メニューへのドロップ。エクスプローラから引いたファイルと同じ形 (types に Files) を投げる
  test.describe('メニューへのドロップ', () => {
    interface DropFile {
      name: string
      type: string
      bytes: number[]
    }

    async function dropOnMenu(
      p: Page,
      payload: { files?: DropFile[]; text?: string },
    ): Promise<void> {
      // 行をまとめる枠 (ドロップの受け皿) は「サーバへコピー」ボタンの親
      const zone = p.getByRole('button', { name: 'サーバへコピー' }).locator('..')
      await zone.evaluate((el, { files, text }) => {
        const dt = new DataTransfer()
        for (const f of files ?? []) {
          dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type }))
        }
        if (text !== undefined) {
          dt.setData('text/plain', text)
        }
        const init = { dataTransfer: dt, bubbles: true, cancelable: true }
        for (const type of ['dragenter', 'dragover', 'drop']) {
          el.dispatchEvent(new DragEvent(type, init))
        }
      }, payload)
    }

    test('ファイルをドロップすると送られる (動画)', async () => {
      const mp4 = [...mp4WithHandlers('isom', ['vide', 'soun'])]
      await openMenu(page)

      await dropOnMenu(page, { files: [{ name: 'clip.mp4', type: 'video/mp4', bytes: mp4 }] })

      await expect(statusNote(page)).toContainText('サーバへ送りました (動画 ')
      await expect(page.getByRole('link', { name: /サーバから保存/ })).toBeVisible()
    })

    test('ドラッグ中は受け皿の見た目になり、落とすと戻る', async () => {
      await openMenu(page)
      const zone = page.getByRole('button', { name: 'サーバへコピー' }).locator('..')

      await zone.evaluate((el) => {
        const dt = new DataTransfer()
        dt.items.add(new File(['x'], 'a.txt', { type: 'text/plain' }))
        el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
      })
      await expect(zone).toHaveClass(/outline-dashed/)

      await zone.evaluate((el) => el.dispatchEvent(new DragEvent('dragleave', { bubbles: true })))
      await expect(zone).not.toHaveClass(/outline-dashed/)
    })

    // 枠は 1 つ。先頭だけ黙って送ると、残りも届いたと思い込む
    test('2 つ以上は送らず、理由を出す', async () => {
      const bytes = [...Buffer.from('%PDF-1.7\n%EOF')]
      await openMenu(page)

      await dropOnMenu(page, {
        files: [
          { name: 'a.pdf', type: 'application/pdf', bytes },
          { name: 'b.pdf', type: 'application/pdf', bytes },
        ],
      })

      await expect(alertNote(page)).toContainText('ファイルは 1 つずつ送ってください')
      expect(((await (await page.request.get('/api/clipboard')).json()).data).slot).toBeNull()
    })

    // 文字の選択や別タブのリンクを引いてきたときは反応しない
    test('文字のドロップは無視する', async () => {
      await openMenu(page)

      await dropOnMenu(page, { text: 'ただの文字' })

      await expect(statusNote(page)).toHaveCount(0)
      await expect(alertNote(page)).toHaveCount(0)
      expect(((await (await page.request.get('/api/clipboard')).json()).data).slot).toBeNull()
    })
  })
})
