import { expect, test } from 'vitest'
import { buildExportMeta, EXPORT_FORMAT, EXPORT_FORMAT_VERSION } from './exportMeta'

const EXPORTED_AT = new Date('2026-08-07T05:00:00.000Z')

test('JSON として読める形で書く', () => {
  const meta = JSON.parse(buildExportMeta(511, EXPORTED_AT))

  expect(meta).toMatchObject({
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: '2026-08-07T05:00:00.000Z',
    noteCount: 511,
  })
})

// 調査で頼りにするのはここ。「どの版が書き出した ZIP か」が判らないと、
// 取り込めない ZIP を渡されたときに版を尋ねるところから始まる
test('アプリの版を載せる', () => {
  const meta = JSON.parse(buildExportMeta(0, EXPORTED_AT))
  expect(meta.appVersion).toMatch(/^\d+\.\d+\.\d+/)
})

// ZIP を展開して中身を確かめるのはたいてい困っているとき。1 行にせず、
// 人が読める形で入れる
test('人が読めるように整形して改行で終える', () => {
  const text = buildExportMeta(1, EXPORTED_AT)
  expect(text).toContain('\n  "format"')
  expect(text.endsWith('\n')).toBe(true)
})
