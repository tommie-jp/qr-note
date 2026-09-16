import { afterEach, describe, expect, test, vi } from 'vitest'
import type { SecretContent } from './content'
import {
  resolveNestedMedia,
  trackBlob,
  type BlobUrlSink,
  type NestedMediaIo,
} from './nestedMedia'
import { SECRET_TEXT_MIME } from './payload'
import { secretUrl } from './secrets'

// 断片の名前 (UUID)。番号で作り分ける
const name = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const ref = (n: number, label = `m${n}`) => `![${label}](${secretUrl(name(n))})`

const content = (mime: string, bytes: number[] = [1, 2, 3]): SecretContent => ({
  mime,
  bytes: Uint8Array.from(bytes),
})

// 読み手と Blob URL の作り手の作り物。読んだ名前と作った Blob を控える
function fakeIo(contents: Record<string, SecretContent | Error>) {
  const loaded: string[] = []
  const blobs: Blob[] = []
  const io: NestedMediaIo = {
    load: async (secretName) => {
      loaded.push(secretName)
      const found = contents[secretName]
      if (found === undefined) {
        throw new Error(`テストに無い断片: ${secretName}`)
      }
      if (found instanceof Error) {
        throw found
      }
      return found
    },
    createObjectUrl: (blob) => {
      blobs.push(blob)
      return `blob:test/${blobs.length - 1}`
    },
  }
  return { io, loaded, blobs }
}

const sink = (): BlobUrlSink => ({ current: [] })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveNestedMedia', () => {
  test('画像・音声・動画の参照を Blob URL に差し替え、種別の対応表を返す', async () => {
    const { io, blobs } = fakeIo({
      [name(1)]: content('image/png', [1]),
      [name(2)]: content('audio/webm', [2, 2]),
      [name(3)]: content('video/mp4', [3, 3, 3]),
    })
    const blobUrls = sink()
    const markdown = `前\n${ref(1)}\n${ref(2)}\n${ref(3)}\n後`

    const result = await resolveNestedMedia(markdown, blobUrls, io)

    expect(result.markdown).toBe(
      '前\n![m1](blob:test/0)\n![m2](blob:test/1)\n![m3](blob:test/2)\n後',
    )
    expect([...result.kinds]).toEqual([
      ['blob:test/0', 'image'],
      ['blob:test/1', 'audio'],
      ['blob:test/2', 'video'],
    ])
    expect(blobUrls.current).toEqual(['blob:test/0', 'blob:test/1', 'blob:test/2'])
    expect(blobs.map((blob) => [blob.type, blob.size])).toEqual([
      ['image/png', 1],
      ['audio/webm', 2],
      ['video/mp4', 3],
    ])
  })

  test('文字の断片は差し替えない (参照を残し、Blob URL も作らない)', async () => {
    const { io, loaded, blobs } = fakeIo({
      [name(1)]: content(SECRET_TEXT_MIME),
    })
    const blobUrls = sink()

    const result = await resolveNestedMedia(ref(1), blobUrls, io)

    expect(loaded).toEqual([name(1)])
    expect(result.markdown).toBe(ref(1))
    expect(result.kinds.size).toBe(0)
    expect(blobs).toEqual([])
    expect(blobUrls.current).toEqual([])
  })

  test('種別の判らない mime も差し替えない', async () => {
    const { io, blobs } = fakeIo({ [name(1)]: content('application/pdf') })

    const result = await resolveNestedMedia(ref(1), sink(), io)

    expect(result.markdown).toBe(ref(1))
    expect(blobs).toEqual([])
  })

  // 黙って消すと「元から無かった」ように見える。参照を残し (割れた画像として
  // 見える)、原因は console.error に残す。残りの断片は続けて開く
  test('開けない断片は参照を残して console.error に記録し、残りは続ける', async () => {
    const cause = new Error('復号に失敗しました')
    const { io } = fakeIo({
      [name(1)]: cause,
      [name(2)]: content('image/webp'),
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await resolveNestedMedia(`${ref(1)}\n${ref(2)}`, sink(), io)

    expect(result.markdown).toBe(`${ref(1)}\n![m2](blob:test/0)`)
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      `断片内の媒体を開けませんでした (${name(1)})`,
      cause,
    )
  })

  test('同じ断片を複数回参照していれば全部を差し替える (読むのは 1 回)', async () => {
    const { io, loaded } = fakeIo({ [name(1)]: content('image/jpeg') })
    const markdown = `${ref(1, 'a')} と ${ref(1, 'b')}`

    const result = await resolveNestedMedia(markdown, sink(), io)

    expect(loaded).toEqual([name(1)])
    expect(result.markdown).toBe('![a](blob:test/0) と ![b](blob:test/0)')
    expect(result.kinds.size).toBe(1)
  })

  // 際限なく並べられると解錠のたびにその数ぶんメモリを掴む (動画は 1 本で
  // 数十 MB)。打ち切りは黙って行わず、超えた分の数を console.warn に出す
  test('媒体は 20 個までで、超えた分は console.warn を出して表示しない', async () => {
    const numbers = Array.from({ length: 21 }, (_, i) => i + 1)
    const { io, loaded } = fakeIo(
      Object.fromEntries(numbers.map((n) => [name(n), content('image/png')])),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const markdown = numbers.map((n) => ref(n)).join('\n')

    const result = await resolveNestedMedia(markdown, sink(), io)

    expect(loaded).toEqual(numbers.slice(0, 20).map((n) => name(n)))
    expect(result.kinds.size).toBe(20)
    expect(result.markdown.endsWith(`\n${ref(21)}`)).toBe(true)
    expect(result.markdown).not.toContain(secretUrl(name(20)))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      '断片内の媒体は 20 個までです (21 個あるうち 1 個を表示していません)',
    )
  })

  test('20 個ちょうどなら警告しない', async () => {
    const numbers = Array.from({ length: 20 }, (_, i) => i + 1)
    const { io } = fakeIo(
      Object.fromEntries(numbers.map((n) => [name(n), content('image/png')])),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await resolveNestedMedia(
      numbers.map((n) => ref(n)).join('\n'),
      sink(),
      io,
    )

    expect(result.kinds.size).toBe(20)
    expect(warn).not.toHaveBeenCalled()
  })

  // 参照の抽出は allSecretNames が正本 (コードの中は対象外)
  test('コードの中の参照は読まず、差し替えない', async () => {
    const { io, loaded } = fakeIo({ [name(1)]: content('image/png') })
    const markdown = `\`${ref(1)}\`\n\`\`\`\n${ref(1)}\n\`\`\``

    const result = await resolveNestedMedia(markdown, sink(), io)

    expect(loaded).toEqual([])
    expect(result.markdown).toBe(markdown)
  })

  test('参照が無ければ何も読まずにそのまま返す', async () => {
    const { io, loaded } = fakeIo({})

    const result = await resolveNestedMedia('ただの本文', sink(), io)

    expect(loaded).toEqual([])
    expect(result).toEqual({ markdown: 'ただの本文', kinds: new Map() })
  })
})

describe('trackBlob', () => {
  test('mime 付きの Blob を URL にして控えの末尾に積む', () => {
    const blobs: Blob[] = []
    const blobUrls: BlobUrlSink = { current: ['blob:test/old'] }

    const url = trackBlob(blobUrls, Uint8Array.from([9, 9]), 'image/png', (blob) => {
      blobs.push(blob)
      return 'blob:test/new'
    })

    expect(url).toBe('blob:test/new')
    expect(blobUrls.current).toEqual(['blob:test/old', 'blob:test/new'])
    expect(blobs).toHaveLength(1)
    expect(blobs[0].type).toBe('image/png')
    expect(blobs[0].size).toBe(2)
  })
})
