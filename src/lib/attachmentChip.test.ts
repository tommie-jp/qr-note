import { describe, expect, test } from 'vitest'
import { attachmentChip } from './attachmentChip'
import { DEFAULT_SECRET_LABEL } from './secrets'

// このチップが要るのは、ライブプレビューが画像記法の生文字を隠すから
// (attachmentChip.ts の冒頭)。**種別ごとに正しく出し分かること**と、
// **シークレットを取りに行かないこと**が要点。

// シークレットの保存名はサーバが振った UUID だけ (secrets.ts の
// SECRET_NAME_PATTERN)。形の違うものはシークレットとして扱われない
const SECRET_SRC = '/api/secrets/0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d'

describe('attachmentChip', () => {
  test('画像はサムネイルを出す', () => {
    const chip = attachmentChip('/api/images/abc.png', '')
    expect(chip.kind).toBe('image')
    expect(chip.thumbnailUrl).toBe('/api/images/abc.png')
  })

  test('音声はサムネイルを出さない', () => {
    // 画像記法に相乗りしているだけで中身は音声。<img> に渡すと必ず割れる
    const chip = attachmentChip('/api/images/abc.mp3', 'audio')
    expect(chip.kind).toBe('audio')
    expect(chip.thumbnailUrl).toBeNull()
  })

  test('動画はサムネイルを出さない', () => {
    const chip = attachmentChip('/api/images/abc.mp4', 'video')
    expect(chip.kind).toBe('video')
    expect(chip.thumbnailUrl).toBeNull()
  })

  test('PDF は挿入時のファイル名をそのまま出す', () => {
    const chip = attachmentChip('/api/images/abc.pdf', '仕様書.pdf')
    expect(chip.kind).toBe('pdf')
    expect(chip.label).toBe('仕様書.pdf')
    expect(chip.thumbnailUrl).toBeNull()
  })

  test('テキストも同じ扱い', () => {
    const chip = attachmentChip('/api/images/abc.md', 'メモ.md')
    expect(chip.kind).toBe('text')
    expect(chip.thumbnailUrl).toBeNull()
  })

  test('シークレットは取りに行かない (暗号文を <img> に渡さない)', () => {
    // 判定順の要。ここが image に落ちると、暗号文を取得しに行ったうえで
    // 割れた画像になる (docs/51-部分暗号化計画.md)
    const chip = attachmentChip(SECRET_SRC, '銀行')
    expect(chip.kind).toBe('secret')
    expect(chip.thumbnailUrl).toBeNull()
    expect(chip.label).toBe('銀行')
  })

  test('alt が空なら種別の名前を出す', () => {
    expect(attachmentChip('/api/images/abc.mp3', '').label).toBe('音声')
    expect(attachmentChip('/api/images/abc.pdf', '').label).toBe('PDF')
    expect(attachmentChip('/api/images/abc.png', '').label).toBe('画像')
  })

  test('alt が空白だけでも種別の名前に落とす', () => {
    // 空白のままだと、チップに何も書かれていない箱が出てしまう
    expect(attachmentChip(SECRET_SRC, '   ').label).toBe(
      DEFAULT_SECRET_LABEL,
    )
  })

  test('種別ごとに違う絵柄を出す', () => {
    const kinds = [
      '/api/images/a.png',
      '/api/images/a.mp3',
      '/api/images/a.mp4',
      '/api/images/a.pdf',
      '/api/images/a.md',
      SECRET_SRC,
    ].map((src) => attachmentChip(src, '').glyph)

    expect(new Set(kinds).size).toBe(kinds.length)
  })

  test('シークレットを装った URL は素通ししない', () => {
    // 名前が UUID の形でなければシークレットではない (secretNameFromUrl が
    // 検算する)。本文は手で書けるので、形だけ似せた URL が入りうる
    const chip = attachmentChip('/api/secrets/not-a-uuid', 'にせもの')
    expect(chip.kind).not.toBe('secret')
  })
})
