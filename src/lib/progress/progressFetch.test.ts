import { describe, expect, test } from 'vitest'
import type { DownloadState } from './progress'
import { createProgressFetch } from './progressFetch'

// 指定チャンクを順に流す Response を返す fetch のフェイク
function fakeFetch(
  chunks: readonly Uint8Array[],
  init: { status?: number; contentLength?: number | null } = {},
): typeof fetch {
  const { status = 200, contentLength = null } = init
  return () => {
    const headers = new Headers()
    if (contentLength !== null) {
      headers.set('content-length', String(contentLength))
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk)
        }
        controller.close()
      },
    })
    return Promise.resolve(new Response(body, { status, headers }))
  }
}

function bytes(length: number): Uint8Array {
  return new Uint8Array(length).fill(1)
}

describe('createProgressFetch', () => {
  test('reports cumulative loaded bytes per chunk with the known total', async () => {
    const snapshots: (readonly DownloadState[])[] = []
    const wrapped = createProgressFetch(
      (states) => snapshots.push(states),
      fakeFetch([bytes(30), bytes(70)], { contentLength: 100 }),
    )

    const res = await wrapped('/model.tar')
    const buffer = await res.arrayBuffer()

    expect(buffer.byteLength).toBe(100)
    expect(snapshots.at(-1)).toEqual([{ loaded: 100, total: 100 }])
    expect(snapshots.some(([s]) => s.loaded === 30)).toBe(true)
  })

  test('preserves the body bytes unchanged', async () => {
    const chunk = new Uint8Array([1, 2, 3, 4, 5])
    const wrapped = createProgressFetch(() => {}, fakeFetch([chunk]))

    const res = await wrapped('/model.tar')

    expect(new Uint8Array(await res.arrayBuffer())).toEqual(chunk)
  })

  test('reports total as null when Content-Length is missing', async () => {
    const snapshots: (readonly DownloadState[])[] = []
    const wrapped = createProgressFetch(
      (states) => snapshots.push(states),
      fakeFetch([bytes(10)], { contentLength: null }),
    )

    await (await wrapped('/model.tar')).arrayBuffer()

    expect(snapshots.at(-1)).toEqual([{ loaded: 10, total: null }])
  })

  test('tracks concurrent downloads as separate entries in one snapshot', async () => {
    const snapshots: (readonly DownloadState[])[] = []
    const wrapped = createProgressFetch(
      (states) => snapshots.push(states),
      fakeFetch([bytes(50)], { contentLength: 50 }),
    )

    const [a, b] = await Promise.all([wrapped('/det.tar'), wrapped('/rec.tar')])
    await Promise.all([a.arrayBuffer(), b.arrayBuffer()])

    const last = snapshots.at(-1)
    expect(last).toHaveLength(2)
    expect(last?.reduce((sum, s) => sum + s.loaded, 0)).toBe(100)
  })

  test('passes non-ok responses through untouched (SDK handles the error)', async () => {
    const wrapped = createProgressFetch(() => {}, fakeFetch([], { status: 404 }))

    const res = await wrapped('/missing.tar')

    expect(res.status).toBe(404)
  })

  test('preserves status and headers on wrapped responses', async () => {
    const wrapped = createProgressFetch(
      () => {},
      fakeFetch([bytes(5)], { contentLength: 5 }),
    )

    const res = await wrapped('/model.tar')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('5')
  })
})
