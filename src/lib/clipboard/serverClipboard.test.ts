import { describe, expect, test, vi } from 'vitest'
import {
  clearServerSlot,
  fetchServerSlot,
  receiveFromServer,
  sendClipboardToServer,
  sendFileToServer,
  serverClipboardErrorMessage,
  SERVER_CLIPBOARD_DATA_URL,
  type ServerClipboardDeps,
} from './serverClipboard'

const META_TEXT = { kind: 'text', bytes: 3, updatedAt: '2026-10-25T12:00:00.000Z', text: 'abc' }
const META_IMAGE = {
  kind: 'image',
  bytes: 8,
  updatedAt: '2026-10-25T12:00:00.000Z',
  mime: 'image/png',
}

const envelope = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, data, error: null }), { status })
const failure = (error: string, status: number) =>
  new Response(JSON.stringify({ success: false, data: null, error }), { status })

function entry(parts: Record<string, Blob>) {
  return { types: Object.keys(parts), getType: async (type: string) => parts[type] as Blob }
}

function deps(overrides: Partial<ServerClipboardDeps> = {}) {
  const fetchFn = vi.fn(async () => envelope({ slot: META_TEXT }))
  const base: ServerClipboardDeps = {
    clipboard: {
      read: vi.fn(async () => [entry({ 'text/plain': new Blob(['abc']) })]),
      writeText: vi.fn(async () => {}),
    },
    fetchFn: fetchFn as unknown as typeof fetch,
    shrink: vi.fn(async () => new File([new Uint8Array(100)], 'shrunk.jpg', { type: 'image/jpeg' })),
    copyImage: vi.fn(async () => {}),
  }
  return { ...base, ...overrides, fetchFn: (overrides.fetchFn ?? base.fetchFn) as typeof fetch }
}

const PNG_BLOB = (size = 8) => new Blob([new Uint8Array(size)], { type: 'image/png' })

describe('sendClipboardToServer', () => {
  // iOS は await の後の read() を NotAllowedError で弾く (docs/92 §8)。
  // 非同期関数でも、最初の await までは同期で走るので呼び出しの時点で read 済みでなければならない
  test('read() は呼び出しの同期部で呼ぶ', () => {
    const d = deps()

    void sendClipboardToServer(d)

    expect(d.clipboard.read).toHaveBeenCalledTimes(1)
  })

  test('文字は JSON で PUT /api/clipboard へ送り、メタを返す', async () => {
    const d = deps()

    const meta = await sendClipboardToServer(d)

    expect(meta).toEqual(META_TEXT)
    const [url, init] = (d.fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/clipboard')
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(JSON.stringify({ text: 'abc' }))
  })

  test('画像は生バイトで PUT /api/clipboard/data へ送る', async () => {
    const png = PNG_BLOB()
    const d = deps({
      clipboard: { read: async () => [entry({ 'image/png': png })], writeText: async () => {} },
      fetchFn: (async () => envelope({ slot: META_IMAGE })) as unknown as typeof fetch,
    })
    const spy = vi.spyOn(d, 'fetchFn')

    const meta = await sendClipboardToServer(d)

    expect(meta).toEqual(META_IMAGE)
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(SERVER_CLIPBOARD_DATA_URL)
    expect(init.method).toBe('PUT')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/png')
    expect(init.body).toBeInstanceOf(Blob)
    expect(d.shrink).not.toHaveBeenCalled()
  })

  // iOS の写真は PNG で 20〜30MB になる (docs/92 §8)
  test('10MB を超える画像は縮めてから送る', async () => {
    const big = PNG_BLOB(10 * 1024 * 1024 + 1)
    const d = deps({
      clipboard: { read: async () => [entry({ 'image/png': big })], writeText: async () => {} },
      fetchFn: (async () => envelope({ slot: META_IMAGE })) as unknown as typeof fetch,
    })
    const spy = vi.spyOn(d, 'fetchFn')

    await sendClipboardToServer(d)

    expect(d.shrink).toHaveBeenCalledTimes(1)
    const [, init] = spy.mock.calls[0] as [string, RequestInit]
    expect((init.body as Blob).size).toBe(100)
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg')
  })

  // 動くものを黙って止めるより、サーバの「大きすぎます」で断るほうが正直
  test('縮められない形式 (GIF) は縮めずに送る', async () => {
    const gif = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/gif' })
    const d = deps({
      clipboard: { read: async () => [entry({ 'image/gif': gif })], writeText: async () => {} },
      fetchFn: (async () => failure('ファイルが大きすぎます (最大 10MB)', 413)) as unknown as typeof fetch,
    })

    await expect(sendClipboardToServer(d)).rejects.toThrow('ファイルが大きすぎます (最大 10MB)')
    expect(d.shrink).not.toHaveBeenCalled()
  })

  test('画像も文字も無ければ断る', async () => {
    const d = deps({
      clipboard: { read: async () => [entry({ 'text/html': new Blob(['<b>x</b>']) })], writeText: async () => {} },
    })

    await expect(sendClipboardToServer(d)).rejects.toThrow('クリップボードに画像も文字もありません')
    expect(d.fetchFn).not.toHaveBeenCalled()
  })

  test('空の文字は断る (サーバの枠を空にしたいなら「消す」)', async () => {
    const d = deps({
      clipboard: { read: async () => [entry({ 'text/plain': new Blob(['']) })], writeText: async () => {} },
    })

    await expect(sendClipboardToServer(d)).rejects.toThrow('クリップボードの文字が空です')
    expect(d.fetchFn).not.toHaveBeenCalled()
  })

  test('read が無い環境は理由を言って断る', async () => {
    const d = deps({ clipboard: { writeText: async () => {} } })

    await expect(sendClipboardToServer(d)).rejects.toThrow('この環境ではクリップボードを読めません')
  })

  test('サーバが断ればその文言を投げる', async () => {
    const d = deps({
      fetchFn: (async () => failure('文字が大きすぎます (最大 64KB)', 413)) as unknown as typeof fetch,
    })

    await expect(sendClipboardToServer(d)).rejects.toThrow('文字が大きすぎます (最大 64KB)')
  })

  test('応答が封筒でなくても状態コードで説明する', async () => {
    const d = deps({
      fetchFn: (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch,
    })

    await expect(sendClipboardToServer(d)).rejects.toThrow('サーバが応答しませんでした (502)')
  })
})

describe('sendFileToServer (ファイルを選んで送る)', () => {
  const MB = 1024 * 1024
  const fileOf = (name: string, type: string, size = 100) =>
    new File([new Uint8Array(size)], name, { type })
  const ok = () =>
    deps({ fetchFn: (async () => envelope({ slot: META_IMAGE })) as unknown as typeof fetch })

  test('生バイトを PUT し、元の名前を X-File-Name に URL エンコードで添える', async () => {
    const d = ok()
    const spy = vi.spyOn(d, 'fetchFn')
    const file = fileOf('資料 1.csv', 'text/csv')

    const meta = await sendFileToServer(file, d)

    expect(meta).toEqual(META_IMAGE)
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(SERVER_CLIPBOARD_DATA_URL)
    expect(init.method).toBe('PUT')
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('text/csv')
    expect(headers['X-File-Name']).toBe(encodeURIComponent('資料 1.csv'))
    expect(init.body).toBe(file)
  })

  test('種類が分からないファイルは octet-stream で送る (形式の判定はサーバの仕事)', async () => {
    const d = ok()
    const spy = vi.spyOn(d, 'fetchFn')

    await sendFileToServer(fileOf('a.heic', ''), d)

    const [, init] = spy.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream')
  })

  test('空のファイルは送らない', async () => {
    const d = ok()
    const spy = vi.spyOn(d, 'fetchFn')

    await expect(sendFileToServer(fileOf('a.txt', 'text/plain', 0), d)).rejects.toThrow(
      'ファイルが空です',
    )
    expect(spy).not.toHaveBeenCalled()
  })

  // 必要なら変換する: 10MB を超える写真は縮めて送る (動画のように縮められないものは除く)
  test('10MB を超える写真は縮めてから送る', async () => {
    const d = ok()
    const spy = vi.spyOn(d, 'fetchFn')

    await sendFileToServer(fileOf('big.png', 'image/png', 11 * MB), d)

    expect(d.shrink).toHaveBeenCalledTimes(1)
    const [, init] = spy.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg')
    expect((init.headers as Record<string, string>)['X-File-Name']).toBe('shrunk.jpg')
  })

  test('10MB 以下の写真は触らない (原本のまま)', async () => {
    const d = ok()

    await sendFileToServer(fileOf('photo.jpg', 'image/jpeg', 9 * MB), d)

    expect(d.shrink).not.toHaveBeenCalled()
  })

  test('縮められない形式 (GIF) の 10MB 超は送る前に断る', async () => {
    const d = ok()
    const spy = vi.spyOn(d, 'fetchFn')

    await expect(sendFileToServer(fileOf('a.gif', 'image/gif', 11 * MB), d)).rejects.toThrow(
      'ファイルが大きすぎます (最大 10MB)',
    )
    expect(spy).not.toHaveBeenCalled()
  })

  test('動画は 30MB まで。超えれば送る前に断る', async () => {
    const d = ok()

    await sendFileToServer(fileOf('a.mp4', 'video/mp4', 25 * MB), d)
    await expect(sendFileToServer(fileOf('b.mp4', 'video/mp4', 31 * MB), d)).rejects.toThrow(
      'ファイルが大きすぎます (最大 30MB)',
    )
  })

  test('PDF など写真以外の 10MB 超は断る', async () => {
    const d = ok()

    await expect(
      sendFileToServer(fileOf('a.pdf', 'application/pdf', 11 * MB), d),
    ).rejects.toThrow('ファイルが大きすぎます (最大 10MB)')
  })

  test('サーバが断ればその文言を投げる', async () => {
    const d = deps({
      fetchFn: (async () =>
        failure('この形式のファイルは送れません (画像・動画・音声・PDF・テキストに対応しています)', 400)) as unknown as typeof fetch,
    })

    await expect(sendFileToServer(fileOf('a.zip', 'application/zip'), d)).rejects.toThrow(
      'この形式のファイルは送れません',
    )
  })
})

describe('receiveFromServer', () => {
  test('文字は writeText に渡す', async () => {
    const d = deps()

    await receiveFromServer(META_TEXT as never, d)

    expect(d.clipboard.writeText).toHaveBeenCalledWith('abc')
    expect(d.copyImage).not.toHaveBeenCalled()
  })

  test('画像は PNG 化つきのコピー関数に配信の URL を渡す', async () => {
    const d = deps()

    await receiveFromServer(META_IMAGE as never, d)

    expect(d.copyImage).toHaveBeenCalledWith(SERVER_CLIPBOARD_DATA_URL)
    expect(d.clipboard.writeText).not.toHaveBeenCalled()
  })

  // 文字は同期で書く。画像は copyImage が同期部で ClipboardItem を作る
  test('writeText は呼び出しの同期部で呼ぶ', () => {
    const d = deps()

    void receiveFromServer(META_TEXT as never, d)

    expect(d.clipboard.writeText).toHaveBeenCalledTimes(1)
  })

  // 動画・音声・PDF・テキストのファイルは、ブラウザからクリップボードに載せる手段が無い。
  // 受け取りは「保存」のリンクで、ここへ来るのは呼ぶ側の取り違え
  test('クリップボードに載せられない種類は断る', async () => {
    const d = deps()
    const video = { kind: 'video', bytes: 1, updatedAt: 'x', mime: 'video/mp4' }

    await expect(receiveFromServer(video as never, d)).rejects.toThrow(
      'この種類のファイルはクリップボードに載せられません',
    )
    expect(d.copyImage).not.toHaveBeenCalled()
  })

  test('writeText が無い環境は理由を言って断る', async () => {
    const d = deps({ clipboard: {} })

    await expect(receiveFromServer(META_TEXT as never, d)).rejects.toThrow(
      'この環境ではクリップボードに書けません',
    )
  })
})

describe('fetchServerSlot / clearServerSlot', () => {
  test('メタを返す。無ければ null', async () => {
    const some = deps({ fetchFn: (async () => envelope({ slot: META_TEXT })) as unknown as typeof fetch })
    const none = deps({ fetchFn: (async () => envelope({ slot: null })) as unknown as typeof fetch })

    expect(await fetchServerSlot(some)).toEqual(META_TEXT)
    expect(await fetchServerSlot(none)).toBeNull()
  })

  test('取れなければ投げる', async () => {
    const d = deps({ fetchFn: (async () => failure('ログインが必要です', 401)) as unknown as typeof fetch })

    await expect(fetchServerSlot(d)).rejects.toThrow('ログインが必要です')
  })

  test('消すは DELETE', async () => {
    const d = deps({ fetchFn: (async () => envelope({ slot: null })) as unknown as typeof fetch })
    const spy = vi.spyOn(d, 'fetchFn')

    await clearServerSlot(d)

    expect(spy.mock.calls[0]?.[0]).toBe('/api/clipboard')
    expect((spy.mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE')
  })
})

describe('serverClipboardErrorMessage', () => {
  const notAllowed = Object.assign(new Error('x'), { name: 'NotAllowedError' })

  test('送るときの NotAllowedError は読み取りが許可されなかった', () => {
    expect(serverClipboardErrorMessage(notAllowed, 'send')).toBe(
      'クリップボードの読み取りが許可されませんでした',
    )
  })

  test('受け取るときの NotAllowedError は書き込みが許可されなかった', () => {
    expect(serverClipboardErrorMessage(notAllowed, 'receive')).toBe(
      'クリップボードへの書き込みが許可されませんでした',
    )
  })

  test('それ以外はメッセージをそのまま', () => {
    expect(serverClipboardErrorMessage(new Error('boom'), 'send')).toBe('boom')
  })
})
