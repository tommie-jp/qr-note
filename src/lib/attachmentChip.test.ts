import { describe, expect, test } from 'vitest'
import { attachmentChip } from './attachmentChip'
import { thumbUrl } from './memoImages'
import { DEFAULT_SECRET_LABEL } from './secrets'

// このチップが要るのは、ライブプレビューが画像記法の生文字を隠すから
// (attachmentChip.ts の冒頭)。**種別ごとに正しく出し分かること**と、
// **シークレットを取りに行かないこと**が要点。

// シークレットの保存名はサーバが振った UUID だけ (secrets.ts の
// SECRET_NAME_PATTERN)。形の違うものはシークレットとして扱われない
const SECRET_SRC = '/api/secrets/0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d'

// 自前の画像の保存名はサーバが振った UUID + 拡張子 (uploads.ts)
const IMAGE_NAME = '0421547b-ee29-4613-a6d4-da0f41f94054.png'
const IMAGE_SRC = `/api/images/${IMAGE_NAME}`

describe('attachmentChip', () => {
  test('画像は縮小版 (?thumb=1) を出す', () => {
    // 原寸は 1 枚数 MB ありうる。1.75rem の箱のために原寸を落とすと、
    // 写真 10 枚のノートを開いただけで数十 MB を引くことになる
    const chip = attachmentChip(IMAGE_SRC, '')
    expect(chip.kind).toBe('image')
    expect(chip.thumbnailUrl).toBe(thumbUrl(IMAGE_NAME))
  })

  test('外部の画像は取りに行かない', () => {
    // 編集画面を開くだけで第三者へ要求が飛ぶ。一覧プレビュー
    // (NotePreviewThumb) が外部画像をチップ止まりにするのと同じ方針
    const chip = attachmentChip('https://example.com/photo.png', '写真')
    expect(chip.kind).toBe('image')
    expect(chip.thumbnailUrl).toBeNull()
  })

  test('保存名の形をしていない自前 URL も取りに行かない', () => {
    // 本文は手で書けるので、書式外れの URL が入りうる。?thumb=1 を付けても
    // 配信側が 400 で断るだけなので、はじめから出さない
    const chip = attachmentChip('/api/images/abc.png', '')
    expect(chip.thumbnailUrl).toBeNull()
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

  test('alt の幅記法はラベルから剥がす', () => {
    // `![図|200](url)` の 200 は表示幅の指定 (altWidth.ts)。剥がさないと
    // チップに「図|200」と出る。閲覧・一覧プレビューは既に剥がしている
    expect(attachmentChip(IMAGE_SRC, '回路図|200').label).toBe('回路図')
    expect(attachmentChip('/api/images/abc.pdf', '仕様書|80').label).toBe(
      '仕様書',
    )
  })

  test('幅記法だけの alt は種別の名前に落とす', () => {
    // `![|200](url)` は幅だけの指定。剥がすとラベルが空になる
    expect(attachmentChip(IMAGE_SRC, '|200').label).toBe('画像')
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
