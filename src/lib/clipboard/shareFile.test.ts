import { expect, test, vi } from 'vitest'
import {
  attachmentShareName,
  canShareFiles,
  isIosWebKit,
  isShareAborted,
  isShareActivationLost,
  shareFile,
} from './shareFile'

function fakeNavigator(options: {
  share?: unknown
  canShare?: unknown
  standalone?: boolean
}): Navigator {
  return options as unknown as Navigator
}

test('share と canShare が揃い、ファイルを受け付けるなら true', () => {
  const nav = fakeNavigator({
    share: () => Promise.resolve(),
    canShare: () => true,
  })
  expect(canShareFiles(nav)).toBe(true)
})

test('share が無ければ false', () => {
  expect(canShareFiles(fakeNavigator({ canShare: () => true }))).toBe(false)
})

// URL 共有はできてもファイル共有はできない環境がある (Web Share Level 2 が別物)。
// share の有無だけで判断すると、押しても失敗するボタンを出してしまう
test('canShare が無ければ false (share だけでは判断しない)', () => {
  expect(canShareFiles(fakeNavigator({ share: () => {} }))).toBe(false)
})

test('canShare がファイルを拒否するなら false', () => {
  const nav = fakeNavigator({ share: () => {}, canShare: () => false })
  expect(canShareFiles(nav)).toBe(false)
})

test('canShare が投げても false を返す (throw しない)', () => {
  const nav = fakeNavigator({
    share: () => {},
    canShare: () => {
      throw new Error('not supported')
    },
  })
  expect(() => canShareFiles(nav)).not.toThrow()
  expect(canShareFiles(nav)).toBe(false)
})

test('ファイル名と渡した MIME を付けて共有する', async () => {
  const share = vi.fn().mockResolvedValue(undefined)
  const nav = fakeNavigator({ share, canShare: () => true })
  const bytes = new TextEncoder().encode('%PDF-1.7\n')

  await shareFile(bytes, '仕様書.pdf', 'application/pdf', nav)

  expect(share).toHaveBeenCalledTimes(1)
  const arg = share.mock.calls[0][0] as { files: File[]; title: string }
  expect(arg.title).toBe('仕様書.pdf')
  expect(arg.files).toHaveLength(1)
  expect(arg.files[0].name).toBe('仕様書.pdf')
  expect(arg.files[0].type).toBe('application/pdf')
  expect(arg.files[0].size).toBe(bytes.byteLength)
})

test('mime は渡した値を使う (音声など PDF 以外も共有できる)', async () => {
  const share = vi.fn().mockResolvedValue(undefined)
  const nav = fakeNavigator({ share, canShare: () => true })

  await shareFile(new Uint8Array([1, 2, 3]), '録音.webm', 'audio/webm', nav)

  const arg = share.mock.calls[0][0] as { files: File[] }
  expect(arg.files[0].type).toBe('audio/webm')
  expect(arg.files[0].name).toBe('録音.webm')
})

test('共有した中身が元のバイト列と一致する', async () => {
  const share = vi.fn().mockResolvedValue(undefined)
  const nav = fakeNavigator({ share, canShare: () => true })
  const bytes = new TextEncoder().encode('%PDF-1.7\nhello')

  await shareFile(bytes, 'x.pdf', 'application/pdf', nav)

  const arg = share.mock.calls[0][0] as { files: File[] }
  const got = new Uint8Array(await arg.files[0].arrayBuffer())
  expect([...got]).toEqual([...bytes])
})

// 共有ボタンは「API が使えるか」ではなく「要るか + 動くか」で出し分ける。
// 両方を満たすのは iOS だけ (PC/Android はネイティブ保存があり、Chromium は
// files 付き share を恒久拒否する)。判定は navigator.standalone の**有無**
test('iOS WebKit (navigator.standalone が存在) なら true', () => {
  // Safari 通常タブは false が「入っている」。値ではなく存在で判定する
  expect(isIosWebKit(fakeNavigator({ standalone: false }))).toBe(true)
  expect(isIosWebKit(fakeNavigator({ standalone: true }))).toBe(true)
})

test('iOS 以外 (standalone プロパティ自体が無い) では false', () => {
  expect(isIosWebKit(fakeNavigator({}))).toBe(false)
  expect(isIosWebKit(fakeNavigator({ share: () => {} }))).toBe(false)
})

// 保存名 (URL 末尾) は UUID なので、表示名 + 保存名の拡張子で共有名を作る
test('attachmentShareName: 表示名に保存名の拡張子を付ける', () => {
  expect(
    attachmentShareName(
      '/api/images/0f1e2d3c-4b5a-4678-9abc-def012345678.webm',
      '録音 2026-07-20 18:49',
      '録音',
    ),
  ).toBe('録音 2026-07-20 18:49.webm')
})

test('attachmentShareName: 表示名が空・既定なら種別名を宛てる', () => {
  expect(
    attachmentShareName('/api/images/uuid.mp3', 'audio', '録音'),
  ).toBe('audio.mp3') // 既定ラベルでもそのまま名前にする (呼び出し側が渡すもの)
  expect(attachmentShareName('/api/images/uuid.mp3', '   ', '録音')).toBe(
    '録音.mp3',
  )
})

test('attachmentShareName: クエリ・パス区切りを落とす', () => {
  expect(
    attachmentShareName('/api/images/uuid.wav?x=1#y', 'メモ/一覧', '録音'),
  ).toBe('メモ一覧.wav')
})

test('attachmentShareName: 表示名が既に拡張子つきなら二重に付けない', () => {
  expect(
    attachmentShareName('/api/images/uuid.mp3', 'song.mp3', '録音'),
  ).toBe('song.mp3')
})

// fetch で操作直後の許可が切れた場合。バイト列を残して再送するための合図
test('NotAllowedError は activation 切れと判定する (AbortError とは別)', () => {
  const lost = Object.assign(new Error('x'), { name: 'NotAllowedError' })
  expect(isShareActivationLost(lost)).toBe(true)
  expect(isShareActivationLost(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(
    false,
  )
  expect(isShareActivationLost(new Error('boom'))).toBe(false)
  expect(isShareActivationLost(null)).toBe(false)
})

// 共有シートを閉じただけ = 正常系。エラー表示に出さない
test('AbortError は「中断」と判定する', () => {
  const aborted = Object.assign(new Error('cancelled'), { name: 'AbortError' })
  expect(isShareAborted(aborted)).toBe(true)
})

test('それ以外の失敗は中断ではない (握り潰さない)', () => {
  expect(isShareAborted(new Error('boom'))).toBe(false)
  expect(
    isShareAborted(Object.assign(new Error('x'), { name: 'NotAllowedError' })),
  ).toBe(false)
  expect(isShareAborted(null)).toBe(false)
  expect(isShareAborted('AbortError')).toBe(false)
})
