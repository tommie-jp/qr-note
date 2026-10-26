import { describe, expect, test } from 'vitest'
import {
  agoLabel,
  CLIPBOARD_TTL_MS,
  isSlotExpired,
  isPasteable,
  previewText,
  SLOT_THUMB_URL,
  sanitizeFileName,
  withExtension,
  kindOfMime,
  slotFileName,
  MAX_CLIPBOARD_TEXT_BYTES,
  parseSlotMeta,
  slotLabel,
  textByteLength,
} from './slot'

const NOW = new Date('2026-10-25T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('isSlotExpired', () => {
  test('10 分に 1 ミリ秒足りなければ生きている', () => {
    expect(isSlotExpired(ago(CLIPBOARD_TTL_MS - 1), NOW)).toBe(false)
  })

  test('10 分ちょうどで切れる', () => {
    expect(isSlotExpired(ago(CLIPBOARD_TTL_MS), NOW)).toBe(true)
  })

  test('ISO 文字列も受ける', () => {
    expect(isSlotExpired(ago(1000).toISOString(), NOW)).toBe(false)
  })

  // 読めない日時を「生きている」にすると、消えるはずの中身が残り続ける
  test('読めない日時は切れた扱い', () => {
    expect(isSlotExpired('not-a-date', NOW)).toBe(true)
  })
})

describe('textByteLength', () => {
  test('UTF-8 のバイト数で数える', () => {
    expect(textByteLength('abc')).toBe(3)
    expect(textByteLength('あ')).toBe(3)
  })

  test('上限の定数は 64KB', () => {
    expect(MAX_CLIPBOARD_TEXT_BYTES).toBe(64 * 1024)
  })
})

describe('slotLabel', () => {
  test('文字は code point で数える (絵文字は 1 字)', () => {
    expect(slotLabel({ kind: 'text', bytes: 8, updatedAt: '', text: 'a😀b' })).toBe('文字 3 字')
  })

  test('画像は MB (小数 1 桁)', () => {
    expect(slotLabel({ kind: 'image', bytes: 1.2 * 1024 * 1024, updatedAt: '', mime: 'image/png' })).toBe(
      '画像 1.2MB',
    )
  })

  test('小さい画像は KB', () => {
    expect(slotLabel({ kind: 'image', bytes: 512 * 1024, updatedAt: '', mime: 'image/png' })).toBe('画像 512KB')
  })
})

describe('slotLabel (画像以外のファイル)', () => {
  test.each([
    ['video', 'video/mp4', '動画 12.3MB'],
    ['audio', 'audio/mpeg', '音声 12.3MB'],
    ['pdf', 'application/pdf', 'PDF 12.3MB'],
    ['textfile', 'text/csv; charset=utf-8', 'テキストファイル 12.3MB'],
  ] as const)('%s は種類と大きさ', (kind, mime, label) => {
    expect(slotLabel({ kind, bytes: 12.3 * 1024 * 1024, updatedAt: '', mime })).toBe(label)
  })
})

describe('slotLabel (大きさの単位)', () => {
  // 0KB と出すと空のファイルに見える
  test('1KB 未満はバイトで出す', () => {
    expect(slotLabel({ kind: 'file', bytes: 500, updatedAt: '', mime: 'x/y' })).toBe('ファイル 500B')
  })
})

describe('slotLabel (ファイル)', () => {
  test('名前があれば名前と大きさ', () => {
    expect(
      slotLabel({ kind: 'file', bytes: 2.5 * 1024 * 1024, updatedAt: '', mime: 'x/y', name: 'a.docx' }),
    ).toBe('a.docx 2.5MB')
  })

  test('名前が長ければ省く', () => {
    const label = slotLabel({
      kind: 'file',
      bytes: 1024,
      updatedAt: '',
      mime: 'x/y',
      name: `${'あ'.repeat(40)}.docx`,
    })

    expect(label).toContain('…')
    expect(label.endsWith('.docx 1KB')).toBe(true)
  })

  test('名前が無ければ「ファイル」', () => {
    expect(slotLabel({ kind: 'file', bytes: 1024, updatedAt: '', mime: 'x/y' })).toBe('ファイル 1KB')
  })
})

describe('kindOfMime', () => {
  test.each([
    ['image/png', 'image'],
    ['image/heic', 'image'],
    ['video/quicktime', 'video'],
    ['audio/webm', 'audio'],
    ['application/pdf', 'pdf'],
    ['text/markdown; charset=utf-8', 'textfile'],
  ])('%s は %s', (mime, kind) => {
    expect(kindOfMime(mime)).toBe(kind)
  })

  // Office・zip・任意のバイナリは「ファイル」(ダウンロード専用)。種類を決められない空だけ null
  test.each([
    'application/octet-stream',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'x',
  ])('%s は file', (mime) => {
    expect(kindOfMime(mime)).toBe('file')
  })

  test('空は null', () => {
    expect(kindOfMime('')).toBeNull()
  })
})

describe('sanitizeFileName (外へ出る保存名)', () => {
  test.each([
    ['report.docx', 'report.docx'],
    ['成績 1.xlsx', '成績 1.xlsx'],
    // パスは落とす (Windows の C:\fakepath\ も)
    ['C:\\fakepath\\a.pdf', 'a.pdf'],
    ['../../etc/passwd', 'passwd'],
    // ファイル名に使えない文字は _ に
    ['a:b*c?d"e<f>g|h.txt', 'a_b_c_d_e_f_g_h.txt'],
    // 制御文字と先頭のドット (隠しファイル・相対指定)
    ['\u0000\u0007x\ny.txt', 'xy.txt'],
    ['..hidden', 'hidden'],
  ])('%j → %j', (raw, expected) => {
    expect(sanitizeFileName(raw)).toBe(expected)
  })

  test.each([null, undefined, '', '   ', '...', '/'])('名前にならない %j は null', (raw) => {
    expect(sanitizeFileName(raw)).toBeNull()
  })

  // 長すぎる名前は拡張子を残して切る (拡張子が無いと開けない)
  test('長い名前は 100 字以内に収め、拡張子を残す', () => {
    const name = sanitizeFileName(`${'あ'.repeat(200)}.xlsx`)

    expect(name?.length).toBeLessThanOrEqual(100)
    expect(name?.endsWith('.xlsx')).toBe(true)
  })
})

describe('withExtension (変換した後の名前)', () => {
  test.each([
    ['photo.heic', 'jpg', 'photo.jpg'],
    ['IMG 1.TIFF', 'jpg', 'IMG 1.jpg'],
    ['a.b.tiff', 'jpg', 'a.b.jpg'],
    // 拡張子が無ければ足す
    ['photo', 'jpg', 'photo.jpg'],
  ])('%s → %s', (name, ext, expected) => {
    expect(withExtension(name, ext)).toBe(expected)
  })

  test('名前が無ければ null のまま', () => {
    expect(withExtension(null, 'jpg')).toBeNull()
  })
})

describe('isPasteable', () => {
  test('クリップボードに載せられるのは文字と画像だけ', () => {
    expect(isPasteable('text')).toBe(true)
    expect(isPasteable('image')).toBe(true)
    for (const kind of ['video', 'audio', 'pdf', 'textfile', 'file'] as const) {
      expect(isPasteable(kind)).toBe(false)
    }
  })
})

describe('slotFileName (保存するときの名前)', () => {
  const AT = new Date('2026-10-25T12:03:04')

  test.each([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['video/mp4', 'mp4'],
    ['video/quicktime', 'mov'],
    ['audio/mpeg', 'mp3'],
    ['application/pdf', 'pdf'],
    ['text/csv; charset=utf-8', 'csv'],
    ['text/markdown; charset=utf-8', 'md'],
  ])('%s は .%s', (mime, ext) => {
    expect(
      slotFileName({ kind: kindOfMime(mime) ?? 'image', bytes: 1, updatedAt: '', mime }, AT),
    ).toBe(`clipboard-20261025-120304.${ext}`)
  })

  // 元の名前が残っているファイルは、その名前で保存する (拡張子が要る)
  test('名前があればそれを使う', () => {
    expect(
      slotFileName(
        { kind: 'file', bytes: 1, updatedAt: '', mime: 'application/octet-stream', name: '成績.xlsx' },
        AT,
      ),
    ).toBe('成績.xlsx')
  })

  test('名前の無いファイルは mime から拡張子を決める (知らない物は bin)', () => {
    expect(
      slotFileName({ kind: 'file', bytes: 1, updatedAt: '', mime: 'application/octet-stream' }, AT),
    ).toBe('clipboard-20261025-120304.bin')
  })

  test('文字は txt', () => {
    expect(slotFileName({ kind: 'text', bytes: 1, updatedAt: '', text: 'a' }, AT)).toBe(
      'clipboard-20261025-120304.txt',
    )
  })
})

describe('agoLabel', () => {
  test('1 分未満は「いま」', () => {
    expect(agoLabel(ago(59_000), NOW)).toBe('いま')
  })

  test('分単位で切り捨てる', () => {
    expect(agoLabel(ago(3 * 60_000 + 30_000), NOW)).toBe('3 分前')
    expect(agoLabel(ago(9 * 60_000), NOW)).toBe('9 分前')
  })

  // 時計のずれで未来になっても負の分を出さない
  test('未来の日時は「いま」', () => {
    expect(agoLabel(new Date(NOW.getTime() + 5000), NOW)).toBe('いま')
  })
})

describe('parseSlotMeta', () => {
  test('文字のメタを読む', () => {
    expect(
      parseSlotMeta({ kind: 'text', bytes: 3, updatedAt: '2026-10-25T12:00:00.000Z', text: 'abc' }),
    ).toEqual({ kind: 'text', bytes: 3, updatedAt: '2026-10-25T12:00:00.000Z', text: 'abc' })
  })

  test('ファイルのメタを読む (mime が付き、text は付かない)', () => {
    expect(
      parseSlotMeta({
        kind: 'image',
        bytes: 10,
        updatedAt: '2026-10-25T12:00:00.000Z',
        mime: 'image/png',
      }),
    ).toEqual({ kind: 'image', bytes: 10, updatedAt: '2026-10-25T12:00:00.000Z', mime: 'image/png' })
  })

  test('名前は文字列のときだけ載せる', () => {
    const base = { kind: 'file', bytes: 1, updatedAt: 'x', mime: 'a/b' }

    expect(parseSlotMeta({ ...base, name: 'a.docx' })).toMatchObject({ name: 'a.docx' })
    expect(parseSlotMeta({ ...base, name: 5 })).not.toHaveProperty('name')
  })

  test.each(['video', 'audio', 'pdf', 'textfile', 'file'])('%s も読む', (kind) => {
    expect(
      parseSlotMeta({ kind, bytes: 1, updatedAt: 'x', mime: 'application/x' }),
    ).toMatchObject({ kind })
  })

  // 配布の直後、古い画面が新しいサーバの返す種類を受け取る。成功した送信を
  // 「応答を読めませんでした」にせず、保存できる「ファイル」として出す
  test('知らない種類でも mime があれば file として読む (新しいサーバの種類)', () => {
    expect(
      parseSlotMeta({ kind: 'spreadsheet', bytes: 1, updatedAt: 'x', mime: 'application/x', name: 'a.xlsx' }),
    ).toEqual({ kind: 'file', bytes: 1, updatedAt: 'x', mime: 'application/x', name: 'a.xlsx' })
  })

  test.each([
    null,
    undefined,
    'x',
    42,
    {},
    { kind: 'spreadsheet', bytes: 1, updatedAt: 'x' },
    { kind: 5, bytes: 1, updatedAt: 'x', mime: 'application/x' },
    { kind: 'video', bytes: 1, updatedAt: 'x' },
    { kind: 'image', bytes: -1, updatedAt: 'x' },
    { kind: 'image', bytes: 1 },
    { kind: 'image', bytes: 1, updatedAt: 'x' },
    { kind: 'video', bytes: 1, updatedAt: 'x', mime: 5 },
    { kind: 'text', bytes: 1, updatedAt: 'x' },
  ])('知らない形は null に畳む: %j', (value) => {
    expect(parseSlotMeta(value)).toBeNull()
  })
})

describe('見本 (docs/115)', () => {
  test('見本の絵の口', () => {
    expect(SLOT_THUMB_URL).toBe('/api/clipboard/thumb')
  })

  test('メタの hasThumb と preview を読む', () => {
    const meta = parseSlotMeta({
      kind: 'image',
      bytes: 1,
      updatedAt: 'x',
      mime: 'image/png',
      hasThumb: true,
      preview: 'abc',
    })

    expect(meta).toMatchObject({ hasThumb: true, preview: 'abc' })
  })

  test('hasThumb が true でなければ載せない。preview は文字列のときだけ', () => {
    const meta = parseSlotMeta({
      kind: 'image',
      bytes: 1,
      updatedAt: 'x',
      mime: 'image/png',
      hasThumb: 'yes',
      preview: 5,
    })

    expect(meta).not.toHaveProperty('hasThumb')
    expect(meta).not.toHaveProperty('preview')
  })

  describe('previewText (抜粋)', () => {
    test('4 行までで切り、続きがあれば … を付ける', () => {
      expect(previewText('1\n2\n3\n4\n5')).toBe('1\n2\n3\n4…')
    })

    test('4 行以内ならそのまま', () => {
      expect(previewText('a\n\nb')).toBe('a\n\nb')
    })

    test('長い 1 行は 300 字で切る (code point で数える)', () => {
      const cut = previewText('😀'.repeat(400))

      expect(Array.from(cut)).toHaveLength(301)
      expect(cut.endsWith('…')).toBe(true)
    })

    test('CRLF も行として数える', () => {
      expect(previewText('1\r\n2\r\n3\r\n4\r\n5')).toBe('1\n2\n3\n4…')
    })

    test('前後の空白行は落とす', () => {
      expect(previewText('\n\n  a\n')).toBe('  a')
    })
  })
})
