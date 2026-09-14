import { describe, expect, test } from 'vitest'
import { extractTags } from './tags'
import {
  addTagToMemo,
  addTagsToMemo,
  removeTagFromMemo,
  removeTagsFromMemo,
} from './edit'

describe('addTagToMemo', () => {
  test('空メモはタグ単独行にする (先頭に空行を作らない)', () => {
    expect(addTagToMemo('', 'bjt')).toBe('#bjt')
    expect(addTagToMemo('   \n  ', 'bjt')).toBe('#bjt')
  })

  test('1 行だけのメモには 2 行目としてタグ行を挿入する', () => {
    expect(addTagToMemo('BJT NPN 2SC2712', 'bjt')).toBe('BJT NPN 2SC2712\n#bjt')
  })

  test('2 行目が既にタグ行なら行末に追記する', () => {
    expect(addTagToMemo('BJT NPN\n#bjt', 'npn')).toBe('BJT NPN\n#bjt #npn')
  })

  test('2 行目が本文 (タグ無し) ならタグ行を 2 行目に挿入し本文は下へ送る', () => {
    expect(addTagToMemo('タイトル\n説明文\n#bjt', 'npn')).toBe(
      'タイトル\n#npn\n説明文\n#bjt',
    )
  })

  test('本文のどこかに既にそのタグがあれば何もしない (重複防止)', () => {
    expect(addTagToMemo('BJT NPN\n#bjt', 'bjt')).toBe('BJT NPN\n#bjt')
    // 文章中に混ざったタグも既出とみなす
    expect(addTagToMemo('目玉型ランプ RITEX #1612 隣家前', '1612')).toBe(
      '目玉型ランプ RITEX #1612 隣家前',
    )
  })

  test('全角/大小を同一視して重複を防ぐ', () => {
    // 既存が全角 ＃ＮＰＮ、追加要求が npn → 既出なので無変更
    expect(addTagToMemo('タイトル\n＃ＮＰＮ', 'npn')).toBe('タイトル\n＃ＮＰＮ')
    // 追加するタグ名自体も正規化して書き込む
    expect(addTagToMemo('タイトル', 'ＢＪＴ')).toBe('タイトル\n#bjt')
  })

  test('2 行目が本文中タグの行でも (タグだけの行でなければ) 挿入する', () => {
    // "RITEX #1612 隣家前" はタグ行ではないので、そこへ追記せず 2 行目に挿入。
    // これで削除 (タグだけの行が対象) と対称になり往復できる。
    const memo = 'タイトル\n目玉型ランプ RITEX #1612 隣家前'
    const added = addTagToMemo(memo, 'led')
    expect(added).toBe('タイトル\n#led\n目玉型ランプ RITEX #1612 隣家前')
    expect(removeTagFromMemo(added, 'led')).toBe(memo)
  })

  test('コードフェンスで始まるメモでもタグが必ず索引される (無音失敗しない)', () => {
    const added = addTagToMemo('```\ncode\n```', 'bjt')
    expect(extractTags(added)).toContain('bjt')
    // 再追加しても増えない (冪等)
    expect(addTagToMemo(added, 'bjt')).toBe(added)
  })

  test('CRLF メモでも改行を壊さず追記する', () => {
    // 途中のタグ行に追記しても \r が行中に紛れ込まない
    expect(addTagToMemo('BJT NPN\r\n#bjt\r\nfoo', 'npn')).toBe(
      'BJT NPN\r\n#bjt #npn\r\nfoo',
    )
    // 挿入時も CRLF を保つ
    expect(addTagToMemo('title\r\nbody', 'bjt')).toBe('title\r\n#bjt\r\nbody')
  })
})

describe('addTagsToMemo', () => {
  test('複数タグを同じ 2 行目にまとめて追加する', () => {
    expect(addTagsToMemo('タイトル', ['bjt', 'npn'])).toBe('タイトル\n#bjt #npn')
  })

  test('既出のタグは飛ばして新規だけ追加する', () => {
    expect(addTagsToMemo('タイトル\n#bjt', ['bjt', 'npn'])).toBe(
      'タイトル\n#bjt #npn',
    )
  })
})

describe('removeTagFromMemo', () => {
  test('タグ行から該当タグだけを取り除く (他のタグは残る)', () => {
    expect(removeTagFromMemo('BJT NPN\n#bjt #npn', 'bjt')).toBe('BJT NPN\n#npn')
  })

  test('タグが 1 つだけの行は行ごと削除する', () => {
    expect(removeTagFromMemo('BJT NPN\n#bjt', 'bjt')).toBe('BJT NPN')
  })

  test('文章中に混ざったタグは壊さない (行を残す)', () => {
    // "1612" はタグ行ではなく本文中にあるので触らない
    expect(
      removeTagFromMemo('目玉型ランプ RITEX #1612 隣家前', '1612'),
    ).toBe('目玉型ランプ RITEX #1612 隣家前')
  })

  test('全角/大小を同一視して削除する', () => {
    expect(removeTagFromMemo('タイトル\n＃ＮＰＮ #bjt', 'npn')).toBe(
      'タイトル\n#bjt',
    )
  })

  test('該当タグが無ければ変更しない', () => {
    expect(removeTagFromMemo('タイトル\n#bjt', 'npn')).toBe('タイトル\n#bjt')
  })

  test('CRLF メモから削除しても改行を保つ', () => {
    expect(removeTagFromMemo('L1\r\n#bjt #npn\r\nL3', 'bjt')).toBe(
      'L1\r\n#npn\r\nL3',
    )
  })
})

describe('removeTagsFromMemo', () => {
  test('複数タグをまとめて削除し、空になった行は消す', () => {
    expect(removeTagsFromMemo('タイトル\n#bjt #npn', ['bjt', 'npn'])).toBe(
      'タイトル',
    )
  })
})

describe('add/remove の往復', () => {
  test('追加してから削除すると元に戻る', () => {
    const memo = 'BJT NPN 2SC2712'
    expect(removeTagFromMemo(addTagToMemo(memo, 'bjt'), 'bjt')).toBe(memo)
  })

  test('既存タグ行への追加も削除で元に戻る', () => {
    const memo = 'タイトル\n#npn'
    expect(removeTagFromMemo(addTagToMemo(memo, 'bjt'), 'bjt')).toBe(memo)
  })
})
