import { expect, test } from 'vitest'
import {
  allAttachments,
  allImageNames,
  attachmentUrl,
  firstImageName,
  firstThumbInfo,
  replaceImageName,
} from './memoImages'

const NAME = '0421547b-ee29-4613-a6d4-da0f41f94054.jpg'
const OTHER = '11108562-47b2-4c00-846d-23dd7e804ff8.png'
const VIDEO_MP4 = '2232f915-45fe-4121-836f-0fa6bbd9c4dc.mp4'
const VIDEO_MKV = '1f3f2278-58ec-46f4-8846-128440a4b7fd.mkv'
const AUDIO = '0f1e2d3c-4b5a-4678-9abc-def012345678.webm'
const PDF = '5b6c7d8e-9f01-4234-8567-89abcdef0123.pdf'

test('本文に貼られた画像の名前を返す', () => {
  expect(firstImageName(`写真\n![](/api/images/${NAME})`)).toBe(NAME)
})

test('複数あれば最初のものを返す', () => {
  expect(
    firstImageName(`![](/api/images/${NAME})\n![](/api/images/${OTHER})`),
  ).toBe(NAME)
})

test('alt テキストがあっても読める', () => {
  // 書影は ![書影|120](url) の形で入る (scanRegister.ts)
  expect(firstImageName(`書名\n![書影|120](/api/images/${NAME})`)).toBe(NAME)
})

test('画像が無ければ null', () => {
  expect(firstImageName('ただのメモ')).toBeNull()
  expect(firstImageName('')).toBeNull()
})

test('画像ではないリンクは拾わない', () => {
  // `[...]` は画像ではなくリンク。サムネにする対象ではない
  expect(firstImageName(`[説明](/api/images/${NAME})`)).toBeNull()
})

test('外部の画像は拾わない (サムネを持っているのは自前の画像だけ)', () => {
  expect(firstImageName('![](https://example.com/photo.jpg)')).toBeNull()
})

test('名前の形が不正なものは拾わない', () => {
  // isValidImageName と同じ線引き。パスを組み立てる値なので書式を確かめる
  expect(firstImageName('![](/api/images/../../etc/passwd)')).toBeNull()
  expect(firstImageName('![](/api/images/notauuid.jpg)')).toBeNull()
  expect(firstImageName(`![](/api/images/${NAME.replace('.jpg', '.svg')})`)).toBeNull()
})

test('コードの中の画像記法は拾わない', () => {
  // タグ・プロパティと同じ流儀 (コードの中は記法として読まない)
  expect(firstImageName('```md\n![](/api/images/' + NAME + ')\n```')).toBeNull()
  expect(firstImageName('`![](/api/images/' + NAME + ')`')).toBeNull()
})

test('コードの後ろの画像は拾う', () => {
  expect(
    firstImageName('```md\nexample\n```\n![](/api/images/' + NAME + ')'),
  ).toBe(NAME)
})

test('allImageNames: 自前画像をすべて出現順に返す', () => {
  expect(
    allImageNames(`![](/api/images/${NAME})\n本文\n![](/api/images/${OTHER})`),
  ).toEqual([NAME, OTHER])
})

test('allImageNames: 同じ画像は 1 度だけ (重複除去)', () => {
  expect(
    allImageNames(`![](/api/images/${NAME})\n![](/api/images/${NAME})`),
  ).toEqual([NAME])
})

test('allImageNames: 外部画像・不正名・コード内は除く', () => {
  expect(
    allImageNames(
      `![](https://example.com/x.jpg)\n` +
        `![](/api/images/notauuid.jpg)\n` +
        '`![](/api/images/' + OTHER + ')`\n' +
        `![](/api/images/${NAME})`,
    ),
  ).toEqual([NAME])
})

test('allImageNames: 画像が無ければ空配列', () => {
  expect(allImageNames('ただのメモ')).toEqual([])
})

// firstThumbInfo: 一覧サムネにできる添付 (画像 or 動画 poster) を選ぶ

test('firstThumbInfo: 画像は isVideo=false で返す', () => {
  expect(firstThumbInfo(`写真\n![](/api/images/${NAME})`)).toEqual({
    name: NAME,
    isVideo: false,
  })
})

test('firstThumbInfo: 動画 (mp4/mkv) は isVideo=true で返す', () => {
  expect(firstThumbInfo(`![video](/api/images/${VIDEO_MP4})`)).toEqual({
    name: VIDEO_MP4,
    isVideo: true,
  })
  // webm 動画は .mkv で保存される (音声の .webm と衝突させない)
  expect(firstThumbInfo(`![video](/api/images/${VIDEO_MKV})`)).toEqual({
    name: VIDEO_MKV,
    isVideo: true,
  })
})

test('firstThumbInfo: 出現順で最初の添付を選ぶ (画像優先ではない)', () => {
  // 動画が先なら動画。録画だけのノートでも poster がサムネになる
  expect(firstThumbInfo(`![video](/api/images/${VIDEO_MP4})\n![](/api/images/${NAME})`))
    .toEqual({ name: VIDEO_MP4, isVideo: true })
  expect(firstThumbInfo(`![](/api/images/${NAME})\n![video](/api/images/${VIDEO_MP4})`))
    .toEqual({ name: NAME, isVideo: false })
})

test('firstThumbInfo: 音声・PDF・テキストは thumb を持たないので対象外', () => {
  // 音声の .webm はサムネにできない (thumb カラムが無い)
  expect(firstThumbInfo(`![audio](/api/images/${AUDIO})`)).toBeNull()
  expect(firstThumbInfo('メモだけ')).toBeNull()
  expect(firstThumbInfo('')).toBeNull()
})

test('replaceImageName: 本文の画像 URL を新しい名前へ差し替える', () => {
  expect(
    replaceImageName(`![](/api/images/${NAME})`, NAME, OTHER),
  ).toBe(`![](/api/images/${OTHER})`)
})

test('replaceImageName: 同じ画像が複数箇所にあれば全部差し替える', () => {
  const memo = `![](/api/images/${NAME})\n本文\n![別](/api/images/${NAME})`
  expect(replaceImageName(memo, NAME, OTHER)).toBe(
    `![](/api/images/${OTHER})\n本文\n![別](/api/images/${OTHER})`,
  )
})

test('replaceImageName: 幅記法や alt はそのまま残る (URL の名前部分だけ替える)', () => {
  expect(
    replaceImageName(`![スクショ|200](/api/images/${NAME})`, NAME, OTHER),
  ).toBe(`![スクショ|200](/api/images/${OTHER})`)
})

test('replaceImageName: 対象でない画像はそのまま', () => {
  const memo = `![](/api/images/${OTHER})`
  expect(replaceImageName(memo, NAME, VIDEO_MP4)).toBe(memo)
})

// --- allAttachments (docs/65-オフライン対応計画.md §10) ---
//
// 「圏外でこのノートを開くのに要るファイル一式」なので、**1 つも落とせない**。
// 一覧の顔 (firstThumbInfo) や画像検索の索引 (allImageNames) とは逆の性質で、
// あちらは音声や PDF を意図的に外している

test('allAttachments: 種類を問わず出現順に返す', () => {
  const memo = `![図](/api/images/${NAME})\n![音](/api/images/${AUDIO})\n![資料](/api/images/${PDF})`
  expect(allAttachments(memo).map((a) => a.name)).toEqual([NAME, AUDIO, PDF])
})

test('allAttachments: サムネを持つのは画像と動画だけ', () => {
  const memo = `![図](/api/images/${NAME})\n![録画](/api/images/${VIDEO_MP4})\n![資料](/api/images/${PDF})`
  expect(allAttachments(memo)).toEqual([
    { name: NAME, hasThumb: true },
    { name: VIDEO_MP4, hasThumb: true },
    { name: PDF, hasThumb: false },
  ])
})

test('allAttachments: 同じ添付は 1 度だけ', () => {
  expect(allAttachments(`![a](/api/images/${NAME})\n![b](/api/images/${NAME})`)).toEqual([
    { name: NAME, hasThumb: true },
  ])
})

test('allAttachments: コードの中と外部 URL と不正な名前は拾わない', () => {
  const memo = [
    '```',
    `![図](/api/images/${NAME})`,
    '```',
    '![外](https://example.com/a.jpg)',
    '![変](/api/images/../etc/passwd)',
  ].join('\n')
  expect(allAttachments(memo)).toEqual([])
})

test('attachmentUrl: 原寸の配信 URL を組む', () => {
  expect(attachmentUrl(NAME)).toBe(`/api/images/${NAME}`)
})
