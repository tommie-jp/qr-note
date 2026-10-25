import { describe, expect, test } from 'vitest'
import { readBodyBounded } from './boundedBody'

// Content-Length を申告しない送信 (chunked) を再現するため、ReadableStream を本文にする
function streamed(chunks: Uint8Array[]): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    },
  })
  return new Request('http://localhost/x', {
    method: 'PUT',
    body: stream,
    duplex: 'half',
  } as RequestInit)
}

describe('readBodyBounded', () => {
  test('上限以内なら全部つなげて返す', async () => {
    const bytes = await readBodyBounded(streamed([new Uint8Array([1, 2]), new Uint8Array([3])]), 3)

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('本文が無ければ空', async () => {
    const bytes = await readBodyBounded(new Request('http://localhost/x'), 10)

    expect(bytes).toEqual(new Uint8Array(0))
  })

  // 全部読んでから測ると、申告の無い巨大な本文でメモリを食われる
  test('上限を超えた時点で読むのをやめて null を返す', async () => {
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(4))
      },
    })
    const request = new Request('http://localhost/x', {
      method: 'PUT',
      body: stream,
      duplex: 'half',
    } as RequestInit)

    const bytes = await readBodyBounded(request, 10)

    expect(bytes).toBeNull()
    // 上限 10 に対して 4 バイトずつ。3 回目で超える。無限に読み続けない
    expect(pulled).toBeLessThanOrEqual(4)
  })

  test('ちょうど上限は通る', async () => {
    const bytes = await readBodyBounded(streamed([new Uint8Array(10)]), 10)

    expect(bytes?.byteLength).toBe(10)
  })
})
