import { describe, expect, test } from 'vitest'
import {
  extForMime,
  isAllowedContentMime,
  isValidAttachmentName,
  isValidAudioName,
  isValidImageName,
  isValidPdfName,
  isValidTextName,
  isValidVideoName,
  PDF_MIME,
  uuidNamePattern,
} from './names'

test('対応する画像 MIME は拡張子を返す', () => {
  expect(extForMime('image/png')).toBe('png')
  expect(extForMime('image/jpeg')).toBe('jpg')
  expect(extForMime('image/gif')).toBe('gif')
  expect(extForMime('image/webp')).toBe('webp')
  expect(extForMime('image/avif')).toBe('avif')
})

test('画像以外・危険な MIME は null を返す', () => {
  expect(extForMime('image/svg+xml')).toBeNull() // SVG はスクリプト埋め込み可能なため拒否
  expect(extForMime('text/html')).toBeNull()
  expect(extForMime('application/pdf')).toBeNull()
  expect(extForMime('')).toBeNull()
})

test('UUID + 対応拡張子のファイル名だけを許可する', () => {
  expect(
    isValidImageName('0f1e2d3c-4b5a-4678-9abc-def012345678.png'),
  ).toBe(true)
  expect(isValidImageName('0f1e2d3c-4b5a-4678-9abc-def012345678.jpg')).toBe(true)
  // AVIF は無変換で保存するので保存名にも現れる
  expect(isValidImageName('0f1e2d3c-4b5a-4678-9abc-def012345678.avif')).toBe(true)
})

describe('uuidNamePattern', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'

  test('UUID + 拡張子の選択肢を丸ごと覆う正規表現を作る', () => {
    // Act
    const pattern = uuidNamePattern('png|jpg')

    // Assert: 画像の保存名の正規表現 (リテラルで書いていた頃) と同じ source
    expect(pattern.source).toBe(
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(png|jpg)$',
    )
    expect(pattern.flags).toBe('')
  })

  test('選択肢のどれかで終わる UUID 名だけを通す', () => {
    const pattern = uuidNamePattern('png|jpg')
    expect(pattern.test(`${uuid}.png`)).toBe(true)
    expect(pattern.test(`${uuid}.jpg`)).toBe(true)
    expect(pattern.test(`${uuid}.gif`)).toBe(false)
    // 選択肢は拡張子全体に掛かる (`png|jpg` が `^…png` と `jpg$` に割れない)
    expect(pattern.test(`${uuid}.pngx`)).toBe(false)
    expect(pattern.test(`x${uuid}.jpg`)).toBe(false)
  })

  test('大文字の UUID・拡張子の欠け・パスを含む名前は通さない', () => {
    const pattern = uuidNamePattern('pdf')
    expect(pattern.test(`${uuid}.pdf`)).toBe(true)
    expect(pattern.test(`${uuid.toUpperCase()}.pdf`)).toBe(false)
    expect(pattern.test(`${uuid}.PDF`)).toBe(false)
    expect(pattern.test(uuid)).toBe(false)
    expect(pattern.test(`${uuid}.`)).toBe(false)
    expect(pattern.test(`../${uuid}.pdf`)).toBe(false)
    expect(pattern.test(`${uuid}.pdf/../x`)).toBe(false)
    expect(pattern.test(`${uuid}xpdf`)).toBe(false)
    expect(pattern.test(`${uuid}.pdf\n`)).toBe(false)
  })
})

test('5 種の保存名はそれぞれ自分の拡張子だけを通す', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  const checks: [(name: string) => boolean, string[]][] = [
    [isValidImageName, ['png', 'jpg', 'gif', 'webp', 'avif']],
    [isValidAudioName, ['mp3', 'm4a', 'wav', 'webm']],
    [isValidVideoName, ['mp4', 'mkv', 'mov']],
    [isValidPdfName, ['pdf']],
    [isValidTextName, ['txt', 'csv', 'md']],
  ]
  const allExts = checks.flatMap(([, exts]) => exts)
  for (const [isValid, exts] of checks) {
    for (const ext of allExts) {
      expect(isValid(`${uuid}.${ext}`), `${isValid.name} .${ext}`).toBe(exts.includes(ext))
    }
    expect(isValid(`${uuid.toUpperCase()}.${exts[0]}`)).toBe(false)
    expect(isValid(`../${uuid}.${exts[0]}`)).toBe(false)
    expect(isValid(uuid)).toBe(false)
  }
})

test('パストラバーサル・不正なファイル名を拒否する', () => {
  expect(isValidImageName('../../etc/passwd')).toBe(false)
  expect(isValidImageName('..%2Fsecret.png')).toBe(false)
  expect(isValidImageName('a.png')).toBe(false) // UUID 形式でない
  expect(isValidImageName('0f1e2d3c-4b5a-4678-9abc-def012345678.svg')).toBe(false)
  // HEIC/TIFF は保存時に webp へ変換するため、この拡張子で保存名は作られない
  expect(isValidImageName('0f1e2d3c-4b5a-4678-9abc-def012345678.heic')).toBe(false)
  expect(isValidImageName('0f1e2d3c-4b5a-4678-9abc-def012345678.tiff')).toBe(false)
  expect(isValidImageName('0f1e2d3c-4b5a-4678-9abc-def012345678')).toBe(false)
  expect(isValidImageName('')).toBe(false)
})

// --- 音声 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md) ---

test('webm の保存名と配信 mime を許可する', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidAudioName(`${uuid}.webm`)).toBe(true)
  expect(isValidAttachmentName(`${uuid}.webm`)).toBe(true)
  expect(isAllowedContentMime('audio/webm')).toBe(true)
  // 音声の webm を一覧サムネ・画像検索に混ぜない (webp と 1 文字違いなので明示)
  expect(isValidImageName(`${uuid}.webm`)).toBe(false)
})

test('音声の保存名 (UUID + mp3/m4a/wav) を許可する', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidAudioName(`${uuid}.mp3`)).toBe(true)
  expect(isValidAudioName(`${uuid}.m4a`)).toBe(true)
  expect(isValidAudioName(`${uuid}.wav`)).toBe(true)
  expect(isValidAudioName(`${uuid}.png`)).toBe(false) // 画像は音声名ではない
  expect(isValidAudioName('../../etc/passwd.mp3')).toBe(false)
})

test('isValidImageName は音声名を拾わない (一覧サムネ・画像検索に混ぜない)', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidImageName(`${uuid}.mp3`)).toBe(false)
  expect(isValidImageName(`${uuid}.m4a`)).toBe(false)
  expect(isValidImageName(`${uuid}.wav`)).toBe(false)
})

test('isValidAttachmentName は画像・音声の両方を許可する', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidAttachmentName(`${uuid}.png`)).toBe(true)
  expect(isValidAttachmentName(`${uuid}.mp3`)).toBe(true)
  expect(isValidAttachmentName(`${uuid}.svg`)).toBe(false)
  expect(isValidAttachmentName('../secret.mp3')).toBe(false)
})

test('配信 Content-Type は既知の画像・音声・PDF mime だけ採用する', () => {
  expect(isAllowedContentMime('image/png')).toBe(true)
  expect(isAllowedContentMime('image/webp')).toBe(true)
  expect(isAllowedContentMime('audio/mpeg')).toBe(true)
  expect(isAllowedContentMime('audio/mp4')).toBe(true)
  expect(isAllowedContentMime('audio/wav')).toBe(true)
  expect(isAllowedContentMime(PDF_MIME)).toBe(true)
  // 動画も配信 mime として許可する (41-QR-search/docs/14-動画挿入計画.md)
  expect(isAllowedContentMime('video/mp4')).toBe(true)
  expect(isAllowedContentMime('video/webm')).toBe(true)
  expect(isAllowedContentMime('video/quicktime')).toBe(true)
  // 未知・危険な mime は採用しない (route.ts が octet-stream に落とす)
  expect(isAllowedContentMime('image/svg+xml')).toBe(false)
  expect(isAllowedContentMime('text/html')).toBe(false)
})

// --- PDF (41-QR-search/docs/12-添付ファイル種類拡張メモ.md) ---

test('PDF の保存名 (UUID + .pdf) を許可する', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidPdfName(`${uuid}.pdf`)).toBe(true)
  expect(isValidPdfName(`${uuid}.png`)).toBe(false)
  expect(isValidPdfName('../../etc/passwd.pdf')).toBe(false)
  expect(isValidPdfName('a.pdf')).toBe(false) // UUID 形式でない
})

test('isValidImageName は PDF 名を拾わない (一覧サムネ・画像検索に混ぜない)', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidImageName(`${uuid}.pdf`)).toBe(false)
})

test('isValidAttachmentName は PDF も許可する', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidAttachmentName(`${uuid}.pdf`)).toBe(true)
  expect(isValidAttachmentName('../secret.pdf')).toBe(false)
})

// --- 動画 (41-QR-search/docs/14-動画挿入計画.md) ---

test('動画の保存名 (UUID + mp4/mkv/mov) を許可する', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidVideoName(`${uuid}.mp4`)).toBe(true)
  expect(isValidVideoName(`${uuid}.mkv`)).toBe(true)
  expect(isValidVideoName(`${uuid}.mov`)).toBe(true)
  // .webm は音声 (audio) の保存名。動画の保存名ではない (衝突回避)
  expect(isValidVideoName(`${uuid}.webm`)).toBe(false)
  expect(isValidVideoName(`${uuid}.png`)).toBe(false)
  expect(isValidVideoName('../../etc/passwd.mp4')).toBe(false)
  // 動画も添付名として許可する
  expect(isValidAttachmentName(`${uuid}.mp4`)).toBe(true)
  expect(isValidAttachmentName(`${uuid}.mkv`)).toBe(true)
  // 動画を一覧サムネ・画像検索に混ぜない
  expect(isValidImageName(`${uuid}.mp4`)).toBe(false)
})

// --- テキスト系 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md) ---

test('テキストの保存名は UUID + txt/csv/md だけ許可する', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidTextName(`${uuid}.txt`)).toBe(true)
  expect(isValidTextName(`${uuid}.csv`)).toBe(true)
  expect(isValidTextName(`${uuid}.md`)).toBe(true)
  // 配信すると解釈されうる拡張子は保存名にしない (text/plain で配る前提が崩れる)
  expect(isValidTextName(`${uuid}.html`)).toBe(false)
  expect(isValidTextName(`${uuid}.svg`)).toBe(false)
  expect(isValidTextName('../../etc/passwd')).toBe(false)
  expect(isValidTextName('memo.txt')).toBe(false) // UUID 形式でない
})

test('テキストは配信ゲートを通るが、画像としては扱わない', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidAttachmentName(`${uuid}.txt`)).toBe(true)
  expect(isValidAttachmentName(`${uuid}.csv`)).toBe(true)
  expect(isValidAttachmentName(`${uuid}.md`)).toBe(true)
  // 一覧サムネ・画像検索に混ぜない (音声・PDF と同じ線引き)
  expect(isValidImageName(`${uuid}.txt`)).toBe(false)
  expect(isValidImageName(`${uuid}.md`)).toBe(false)
})

test('テキストの配信 mime は charset つきの text/plain 系だけ', () => {
  expect(isAllowedContentMime('text/plain; charset=utf-8')).toBe(true)
  expect(isAllowedContentMime('text/csv; charset=utf-8')).toBe(true)
  expect(isAllowedContentMime('text/markdown; charset=utf-8')).toBe(true)
  // charset 無しは保存しないので採用しない (常に UTF-8 へ正規化してから保存する)
  expect(isAllowedContentMime('text/plain')).toBe(false)
  expect(isAllowedContentMime('text/html; charset=utf-8')).toBe(false)
})
