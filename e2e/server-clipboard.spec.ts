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
      // 元の名前を残す (拡張子が要る)
      expect(download.suggestedFilename()).toBe('clip.mp4')
      const { createReadStream } = await import('node:fs')
      const chunks: Buffer[] = []
      for await (const chunk of createReadStream((await download.path()) ?? '')) {
        chunks.push(chunk as Buffer)
      }
      expect(Buffer.concat(chunks).equals(mp4)).toBe(true)
    })

    // iPhone のホーム画面アプリには戻るボタンが無い。download 付きのリンクだと
    // ファイルそのものへ遷移して戻れなくなる (実機の報告)。iOS 相当 (navigator.standalone が
    // ある + files 付き share が使える) では、リンクではなく共有シートを開く
    test('iOS 相当では保存がリンクでなく共有シートになり、画面は遷移しない', async ({ browser }) => {
      const ios = await newLoggedInPage(browser)
      await ios.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL })
      await ios.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { value: false, configurable: true })
        const shared: Array<{ name: string; type: string; size: number }> = []
        ;(window as unknown as { __shared: typeof shared }).__shared = shared
        navigator.canShare = () => true
        navigator.share = async (data) => {
          for (const f of data?.files ?? []) {
            shared.push({ name: f.name, type: f.type, size: f.size })
          }
        }
      })
      try {
        await ios.goto('/')
        const mp4 = Buffer.from(mp4WithHandlers('isom', ['vide', 'soun']))
        await openMenu(ios)
        await fileInput(ios).setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: mp4 })
        await expect(statusNote(ios)).toContainText('サーバへ送りました (動画 ')
        const url = ios.url()

        // リンクではなくボタン
        await expect(ios.getByRole('link', { name: /サーバから/ })).toHaveCount(0)
        await ios.getByRole('button', { name: /サーバから共有/ }).click()

        await expect
          .poll(() => ios.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared))
          .toEqual([{ name: 'clip.mp4', type: 'video/mp4', size: mp4.byteLength }])
        expect(ios.url()).toBe(url)
      } finally {
        await closePage(ios)
      }
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

    // Office もあらゆるファイルも運べる。名前と拡張子を保ったまま落ちる
    test('docx を送ると、元の名前のまま保存できる', async () => {
      const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])
      await openMenu(page)

      await fileInput(page).setInputFiles({
        name: '議事録 2026.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docx,
      })

      await expect(statusNote(page)).toContainText('サーバへ送りました (議事録 2026.docx ')
      const save = page.getByRole('link', { name: /サーバから保存/ })
      const [download] = await Promise.all([page.waitForEvent('download'), save.click()])
      expect(download.suggestedFilename()).toBe('議事録 2026.docx')
    })

    // 知らない形式 (zip) も置ける。HTML は名前を偽っても開かれず、保存だけになる
    test('HTML を送っても、ブラウザは開かずダウンロード扱いで配る', async () => {
      const html = Buffer.from('<html><script>document.title="pwned"</script></html>')
      await openMenu(page)

      await fileInput(page).setInputFiles({ name: 'evil.html', mimeType: 'text/html', buffer: html })

      await expect(statusNote(page)).toContainText('サーバへ送りました (evil.html ')
      const stored = await page.request.get('/api/clipboard/data')
      expect(stored.headers()['content-type']).toBe('application/octet-stream')
      expect(stored.headers()['content-disposition']).toContain('attachment')
      expect(stored.headers()['x-content-type-options']).toBe('nosniff')
      expect(stored.headers()['content-security-policy']).toBe('sandbox')
    })

    test('zip も送れる', async () => {
      await openMenu(page)

      await fileInput(page).setInputFiles({
        name: 'a.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0]),
      })

      await expect(statusNote(page)).toContainText('サーバへ送りました (a.zip ')
    })

    test('空のファイルだけは理由を出して置かない', async () => {
      await openMenu(page)

      await fileInput(page).setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) })

      await expect(alertNote(page)).toContainText('ファイルが空です')
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

  // 枠の中身の見本 (docs/115)。「ペースト / 保存 / 共有」の行の下に出る
  test.describe('見本', () => {
    const fileInput = (p: Page) => p.locator('input[type="file"]')
    const previewImage = (p: Page) => p.getByAltText('サーバのクリップボードの見本')

    // pdf.js が描ける最小の PDF (1 ページ・四角を 1 つ塗る)。xref の位置はその場で数える
    function minimalPdf(): Buffer {
      const content = '1 0 0 RG 0.2 0.4 0.8 rg 20 20 160 100 re f'
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 140] /Contents 4 0 R /Resources << >> >>',
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      ]
      let pdf = '%PDF-1.4\n'
      const offsets: number[] = []
      objects.forEach((body, i) => {
        offsets.push(pdf.length)
        pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
      })
      const xref = pdf.length
      pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
      pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
      pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
      return Buffer.from(pdf, 'latin1')
    }

    test('画像を送ると、絵の見本が出て読み込める', async () => {
      await writeImageToClipboard(page)
      await openMenu(page)

      await page.getByRole('button', { name: 'サーバへコピー' }).click()

      await expect(statusNote(page)).toContainText('サーバへ送りました (画像 ')
      await expect(previewImage(page)).toBeVisible()
      await expect
        .poll(() => previewImage(page).evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0)
      const thumb = await page.request.get('/api/clipboard/thumb')
      expect(thumb.headers()['content-type']).toBe('image/webp')
    })

    test('文字を送ると、先頭の抜粋が出る', async () => {
      await page.evaluate(() => navigator.clipboard.writeText('1 行目\n2 行目\n3\n4\n5 行目'))
      await openMenu(page)

      await page.getByRole('button', { name: 'サーバへコピー' }).click()

      await expect(statusNote(page)).toContainText('サーバへ送りました (文字 ')
      await expect(page.getByText(/1 行目\s+2 行目\s+3\s+4…/)).toBeVisible()
    })

    // 動画の絵はクライアントで作って後から貼る。PDF も同じ経路なので、描ける PDF で確かめる
    test('PDF を送ると、1 ページ目の絵が後から貼られて出る', async () => {
      await openMenu(page)

      await fileInput(page).setInputFiles({ name: 'map.pdf', mimeType: 'application/pdf', buffer: minimalPdf() })

      await expect(statusNote(page)).toContainText('サーバへ送りました (PDF ')
      await expect(previewImage(page)).toBeVisible({ timeout: 30_000 })
      const meta = (await (await page.request.get('/api/clipboard')).json()).data.slot
      expect(meta).toMatchObject({ kind: 'pdf', hasThumb: true })
    })

    test('docx を送ると、拡張子の札と本文の抜粋が出る', async () => {
      const { strToU8, zipSync } = await import('fflate')
      const docx = Buffer.from(
        zipSync({
          'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>定例会の議事録</w:t></w:r></w:p></w:body></w:document>'),
        }),
      )
      await openMenu(page)

      await fileInput(page).setInputFiles({
        name: '議事録.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docx,
      })

      await expect(statusNote(page)).toContainText('サーバへ送りました (議事録.docx ')
      await expect(page.getByText('DOCX', { exact: true })).toBeVisible()
      await expect(page.getByText('定例会の議事録')).toBeVisible()
    })

    // chromium は合成の mp4 を描けないので絵は作れず、札で止まる (絵は実機で確かめる)
    test('描けない動画は札のまま (送るのは成功する)', async () => {
      await openMenu(page)

      await fileInput(page).setInputFiles({
        name: 'clip.mp4',
        mimeType: 'video/mp4',
        buffer: Buffer.from(mp4WithHandlers('isom', ['vide', 'soun'])),
      })

      await expect(statusNote(page)).toContainText('サーバへ送りました (動画 ')
      await expect(page.getByText('MP4', { exact: true })).toBeVisible()
      await expect(previewImage(page)).toHaveCount(0)
    })
  })
})
