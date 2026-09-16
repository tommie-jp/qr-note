import { afterEach, describe, expect, test, vi } from 'vitest'
import { failEnvelope, jsonContract, responseContract } from '@/test/routeResponse'
import { MULTIPART_OVERHEAD_BYTES } from '../uploads/limits'
import { MAX_SECRET_BYTES, MAX_SECRET_VIDEO_BYTES, SECRET_MIME_HEADER } from './payload'
import { guardSecretRequest, readSecretBody } from './route'

// シークレットの口が共通で使う門番と本文の読み取り (docs/51-部分暗号化計画.md §10)。
// 門番は route/guard への委譲だけを見る (デモ → ログイン → クロスサイトの順は
// api/secrets/* の route テストが本物で押さえている)
const mocks = vi.hoisted(() => ({
  guardRequest: vi.fn(),
}))

vi.mock('../route/guard', () => ({
  guardRequest: mocks.guardRequest,
}))

const URL_ = 'http://localhost/api/secrets/0421547b-ee29-4613-a6d4-da0f41f94054'

function putRequest(
  headers: Record<string, string>,
  body: BodyInit | null = new Uint8Array([1, 2, 3]),
): Request {
  return new Request(URL_, { method: 'PUT', headers, body })
}

// 通った結果 ({ mime, bytes }) と断った応答 (NextResponse) を見分ける
async function rejected(request: Request) {
  const result = await readSecretBody(request)
  if (!(result instanceof Response)) {
    throw new Error('断られるはずが本文が通った')
  }
  return responseContract(result)
}

async function accepted(request: Request) {
  const result = await readSecretBody(request)
  if (result instanceof Response) {
    throw new Error(`通るはずが断られた (${result.status})`)
  }
  return result
}

afterEach(() => {
  vi.restoreAllMocks()
  mocks.guardRequest.mockReset()
})

describe('guardSecretRequest', () => {
  test('route/guard にデモ拒否付きで委譲し、結果をそのまま返す', async () => {
    // Arrange
    const request = putRequest({})
    const result = { ok: true, user: 'tommie' }
    mocks.guardRequest.mockResolvedValueOnce(result)

    // Act
    const guard = await guardSecretRequest(request)

    // Assert
    expect(guard).toBe(result)
    expect(mocks.guardRequest).toHaveBeenCalledTimes(1)
    expect(mocks.guardRequest).toHaveBeenCalledWith(request, { demo: 'deny' })
  })
})

describe('readSecretBody', () => {
  test('クロスサイトの Origin は本文を読む前に 403', async () => {
    // Arrange
    const request = putRequest({
      origin: 'https://evil.example',
      [SECRET_MIME_HEADER]: 'text/markdown',
    })
    const arrayBuffer = vi.spyOn(request, 'arrayBuffer')

    // Act
    const contract = await rejected(request)

    // Assert
    expect(contract).toEqual(
      jsonContract(403, failEnvelope('クロスオリジンのアップロードは許可されていません')),
    )
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  test('同一オリジンの Origin は通す', async () => {
    const request = putRequest({
      origin: 'http://localhost',
      [SECRET_MIME_HEADER]: 'text/markdown',
    })

    const body = await accepted(request)

    expect(body.mime).toBe('text/markdown')
  })

  // 上限は checkUploadRequest (multipart 前提) に「動画の上限 + 包み分」で渡す。
  // 文言はあの関数が包み分を引いて作るので、足しておかないと「最大 29MB」と
  // 実態と違う数が出る (secret/route.ts の注)。ここでは 30MB を固定する
  test('Content-Length が動画の上限 + 包み分を超えると 413 (文言は 30MB)', async () => {
    // Arrange
    const limit = MAX_SECRET_VIDEO_BYTES + MULTIPART_OVERHEAD_BYTES
    const request = putRequest({
      'content-length': String(limit + 1),
      [SECRET_MIME_HEADER]: 'video/mp4',
    })
    const arrayBuffer = vi.spyOn(request, 'arrayBuffer')

    // Act
    const contract = await rejected(request)

    // Assert
    expect(contract).toEqual(
      jsonContract(413, failEnvelope('ファイルが大きすぎます (最大 30MB)')),
    )
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  test('Content-Length が上限ちょうどなら本文を読みに行く', async () => {
    const limit = MAX_SECRET_VIDEO_BYTES + MULTIPART_OVERHEAD_BYTES
    const request = putRequest({
      'content-length': String(limit),
      [SECRET_MIME_HEADER]: 'video/mp4',
    })

    const body = await accepted(request)

    expect(body.mime).toBe('video/mp4')
  })

  test('種別ヘッダが無ければ 400 (checkSecretPayload の拒否)', async () => {
    const contract = await rejected(putRequest({}))

    expect(contract).toEqual(
      jsonContract(400, failEnvelope('この種類はシークレットにできません')),
    )
  })

  test('知らない種別は 400', async () => {
    const contract = await rejected(putRequest({ [SECRET_MIME_HEADER]: 'text/html' }))

    expect(contract).toEqual(
      jsonContract(400, failEnvelope('この種類はシークレットにできません')),
    )
  })

  test('空の本文は 400', async () => {
    const contract = await rejected(
      putRequest({ [SECRET_MIME_HEADER]: 'text/markdown' }, new Uint8Array(0)),
    )

    expect(contract).toEqual(jsonContract(400, failEnvelope('中身がありません')))
  })

  // 申告 (Content-Length) は無くても実測で絞る。種別ごとの上限なので、
  // 同じ大きさでも画像は断られ、動画は通る
  test('種別ごとの上限は実測で絞る (画像は 10MB で 413、動画なら通る)', async () => {
    // Arrange
    const overImage = new Uint8Array(MAX_SECRET_BYTES + 1)

    // Act
    const image = await rejected(putRequest({ [SECRET_MIME_HEADER]: 'image/png' }, overImage))
    const video = await accepted(putRequest({ [SECRET_MIME_HEADER]: 'video/mp4' }, overImage))

    // Assert
    expect(image).toEqual(
      jsonContract(413, failEnvelope('シークレットが大きすぎます (最大 10MB)')),
    )
    expect(video.bytes.byteLength).toBe(MAX_SECRET_BYTES + 1)
  })

  test('本文を読めなければ 400 にして原因はログに残す', async () => {
    // Arrange
    const request = putRequest({ [SECRET_MIME_HEADER]: 'text/markdown' })
    const cause = new TypeError('terminated')
    vi.spyOn(request, 'arrayBuffer').mockRejectedValueOnce(cause)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Act
    const contract = await rejected(request)

    // Assert
    expect(contract).toEqual(jsonContract(400, failEnvelope('本文を読み取れませんでした')))
    expect(consoleError).toHaveBeenCalledWith(
      'シークレットの本文の読み取りに失敗しました:',
      cause,
    )
  })

  test('通れば申告の種別と本文のバイト列を返す', async () => {
    // Arrange
    const request = putRequest(
      { [SECRET_MIME_HEADER]: 'image/webp' },
      new Uint8Array([9, 8, 7, 6]),
    )

    // Act
    const body = await accepted(request)

    // Assert
    expect(body.mime).toBe('image/webp')
    expect(body.bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(body.bytes)).toEqual([9, 8, 7, 6])
  })
})
