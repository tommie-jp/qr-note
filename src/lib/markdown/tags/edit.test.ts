import { describe, expect, test } from 'vitest'
import { extractTags } from './tags'
import {
  addTagToMemo,
  addTagsToMemo,
  removeTagFromMemo,
  removeTagsFromMemo,
  removeTagsWithEdits,
  restoreRemovedTags,
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

describe('removeTagsWithEdits', () => {
  test('本文は removeTagsFromMemo と同じになり、書き換えた行の元の文と位置を控える', () => {
    // Arrange
    const memo = 'タイトル\n本文\n#bjt #npn\n説明\n#npn'

    // Act
    const { memo: next, edits } = removeTagsWithEdits(memo, ['npn'])

    // Assert
    expect(next).toBe(removeTagsFromMemo(memo, ['npn']))
    expect(edits).toEqual([
      { at: 2, line: '#bjt #npn', removed: false },
      { at: 4, line: '#npn', removed: true },
    ])
  })

  test('該当タグが無ければ控えは空', () => {
    expect(removeTagsWithEdits('タイトル\n#bjt', ['npn'])).toEqual({ memo: 'タイトル\n#bjt', edits: [] })
  })
})

describe('restoreRemovedTags', () => {
  // 外してから戻す。本文がその間に変わっていなければ 1 字違わず元に戻る
  function roundTrip(memo: string, tags: string[]): string {
    const { memo: removed, edits } = removeTagsWithEdits(memo, tags)
    return restoreRemovedTags(removed, tags, edits)
  }

  test.each([
    ['2 行目以外のタグ行', 'タイトル\n本文\n本文2\n#bjt #npn', ['bjt']],
    ['行ごと消えたタグ行', 'タイトル\n本文\n#npn\n続き', ['npn']],
    ['複数のタグ行', '#npn\nタイトル\n#bjt #npn\n本文\n#npn', ['npn']],
    ['全角・余分な空白の書き方', 'タイトル\n  ＃ＮＰＮ   #bjt\n本文', ['npn']],
    ['複数のタグを外した', 'タイトル\n#bjt #npn\n本文\n#bjt', ['bjt', 'npn']],
    ['末尾のタグ行', 'タイトル\n本文\n#npn', ['npn']],
    ['CRLF', 'L1\r\nL2\r\n#bjt #npn\r\nL4', ['npn']],
    ['タグ行だけのメモ', '#npn', ['npn']],
    ['末尾が改行', 'タイトル\n#npn\n', ['npn']],
  ])('%s は元の位置・元の書き方に戻る', (_label, memo, tags) => {
    expect(roundTrip(memo, tags)).toBe(memo)
  })

  test('タグ行より後ろが書き換わっていても元の位置に戻る', () => {
    // Arrange
    const memo = 'タイトル\n本文\n#npn\n続き'
    const { memo: removed, edits } = removeTagsWithEdits(memo, ['npn'])

    // Act
    const restored = restoreRemovedTags(`${removed}\n追記`, ['npn'], edits)

    // Assert
    expect(restored).toBe(`${memo}\n追記`)
  })

  test('前に行が増えて位置が合わなければ、2 行目に足す (タグは必ず戻す)', () => {
    // Arrange
    const memo = 'タイトル\n本文\n#bjt #npn'
    const { memo: removed, edits } = removeTagsWithEdits(memo, ['npn'])

    // Act
    const restored = restoreRemovedTags(`差し込み\n${removed}`, ['npn'], edits)

    // Assert
    expect(restored).toBe(addTagsToMemo(`差し込み\n${removed}`, ['npn']))
  })

  test('消えた行の位置が本文の外なら、2 行目に足す', () => {
    // Arrange
    const memo = 'タイトル\n本文\n続き\n#npn'
    const { edits } = removeTagsWithEdits(memo, ['npn'])

    // Act
    const restored = restoreRemovedTags('タイトル', ['npn'], edits)

    // Assert
    expect(restored).toBe('タイトル\n#npn')
  })

  test('そのタグを既に付け直していれば、重ねて足さない', () => {
    // Arrange
    const memo = 'タイトル\n本文\n#npn'
    const { memo: removed, edits } = removeTagsWithEdits(memo, ['npn'])
    const readded = addTagsToMemo(removed, ['npn'])

    // Act
    const restored = restoreRemovedTags(readded, ['npn'], edits)

    // Assert
    expect(restored).toBe(readded)
    expect(extractTags(restored)).toEqual(['npn'])
  })

  test('控えの行がタグだけの行でなければ使わない (本文を書き込む口にさせない)', () => {
    // Arrange
    const edits = [{ at: 1, line: '#npn 本文を差し込む', removed: true }]

    // Act
    const restored = restoreRemovedTags('タイトル', ['npn'], edits)

    // Assert
    expect(restored).toBe('タイトル\n#npn')
  })
})
