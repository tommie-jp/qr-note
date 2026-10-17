import { describe, expect, test } from 'vitest'
import {
  parseBulkTagForm,
  parseTagInput,
  selectedTagsUnion,
} from './bulk'

function form(entries: Array<[string, string]>): FormData {
  const fd = new FormData()
  for (const [key, value] of entries) {
    fd.append(key, value)
  }
  return fd
}

describe('parseTagInput', () => {
  test('# の有無どちらでも受け取り正規化する', () => {
    expect(parseTagInput('bjt npn')).toEqual(['bjt', 'npn'])
    expect(parseTagInput('#bjt #npn')).toEqual(['bjt', 'npn'])
    expect(parseTagInput('#bjt npn')).toEqual(['bjt', 'npn'])
  })

  test('全角/大小を正規化する', () => {
    expect(parseTagInput('＃ＮＰＮ ＢＪＴ')).toEqual(['npn', 'bjt'])
  })

  test('重複は初出順で 1 つにまとめる', () => {
    expect(parseTagInput('bjt bjt #BJT npn')).toEqual(['bjt', 'npn'])
  })

  test('タグにならないトークンは捨てる', () => {
    // 単独の # / 記号入り / 空白のみ
    expect(parseTagInput('# bjt, #npn')).toEqual(['npn'])
    expect(parseTagInput('   ')).toEqual([])
    expect(parseTagInput('')).toEqual([])
  })

  test('全角スペース区切りも扱う', () => {
    expect(parseTagInput('bjt　npn')).toEqual(['bjt', 'npn'])
  })

  test('異常に多いタグ数は上限で打ち切る (DoS 防御)', () => {
    const many = Array.from({ length: 200 }, (_, i) => `t${i}`).join(' ')
    expect(parseTagInput(many).length).toBe(50)
  })

  test('NFKC 展開でタグに使えない文字になる入力は弾く', () => {
    // ⑴ → "(1)" / ½ → "1⁄2" は書いても再抽出できないため採用しない
    expect(parseTagInput('⑴')).toEqual([])
    expect(parseTagInput('½')).toEqual([])
    // 正常なタグと混在しても、弾くのは展開する文字だけ
    expect(parseTagInput('bjt ⑴ npn')).toEqual(['bjt', 'npn'])
  })
})

describe('selectedTagsUnion', () => {
  const items = [
    { itemId: '00000000-0000-7000-8000-000000000001', tags: ['bjt', 'npn'] },
    { itemId: '00000000-0000-7000-8000-000000000002', tags: ['npn', 'pnp'] },
    { itemId: '00000000-0000-7000-8000-000000000003', tags: ['diode'] },
  ]

  test('選択したアイテムのタグだけを和集合にする', () => {
    expect(selectedTagsUnion(items, ['00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000002'])).toEqual([
      'bjt',
      'npn',
      'pnp',
    ])
  })

  test('選択が無ければ空', () => {
    expect(selectedTagsUnion(items, [])).toEqual([])
  })

  test('結果はタグ名昇順で重複なし', () => {
    expect(selectedTagsUnion(items, ['00000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-000000000003'])).toEqual([
      'diode',
      'npn',
      'pnp',
    ])
  })

  test('存在しない itemId は無視する', () => {
    expect(selectedTagsUnion(items, ['00000000-0000-7000-8000-000000000001', 'zzz'])).toEqual(['bjt', 'npn'])
  })
})

describe('parseBulkTagForm', () => {
  test('addTags があれば add モードで解釈する', () => {
    const req = parseBulkTagForm(
      form([
        ['addTags', 'bjt #npn'],
        ['itemId', '00000000-0000-7000-8000-000000000001'],
        ['itemId', '00000000-0000-7000-8000-000000000002'],
      ]),
    )
    expect(req.mode).toBe('add')
    expect(req.tags).toEqual(['bjt', 'npn'])
    expect(req.itemIds).toEqual(['00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000002'])
    expect(req.back).toBe('/')
  })

  test('removeTag があれば remove モードが優先される', () => {
    const req = parseBulkTagForm(
      form([
        ['removeTag', 'bjt'],
        ['addTags', 'npn'],
        ['itemId', '00000000-0000-7000-8000-000000000001'],
      ]),
    )
    expect(req.mode).toBe('remove')
    expect(req.tags).toEqual(['bjt'])
  })

  test('不正な itemId を除き、重複はまとめる', () => {
    const req = parseBulkTagForm(
      form([
        ['addTags', 'bjt'],
        ['itemId', '00000000-0000-7000-8000-000000000001'],
        ['itemId', '00000000-0000-7000-8000-000000000001'],
        ['itemId', 'bad id!'],
        ['itemId', '00000000-0000-7000-8000-000000000002'],
      ]),
    )
    expect(req.itemIds).toEqual(['00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000002'])
  })

  test('戻り先 URL に q / page / sort を反映する', () => {
    const req = parseBulkTagForm(
      form([
        ['addTags', 'bjt'],
        ['itemId', '00000000-0000-7000-8000-000000000001'],
        ['q', '抵抗'],
        ['page', '3'],
        ['sort', 'itemNo'],
      ]),
    )
    expect(req.back).toBe('/?q=%E6%8A%B5%E6%8A%97&page=3&sort=registered')
  })
})
