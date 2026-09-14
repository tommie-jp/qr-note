import { describe, expect, test } from 'vitest'
import type { Prisma } from '@/generated/prisma/client'
import {
  ALL_CHECKED,
  buildChecksWhere,
  buildNeighborsWhere,
  buildOrderBy,
  buildProgressWhere,
  buildPropsWhere,
  buildTrashedWhere,
  buildWhere,
  ITEM_COLUMNS,
  termCondition,
} from './where'

// SQL 断片の組み立てを DB 無しで固定する (docs/93-リファクタリング計画.md §4-1)。
// 実際に行が当たるかは items.test.ts (RUN_DB_TESTS=1) が見る。ここは
// 「どんな SQL 文とパラメータになるか」だけを押さえ、書き換えで括弧や
// 条件の並びが静かに変わらないようにする。

// 断片の SQL 文 (プレースホルダは ?)。ITEM_COLUMNS のような複数行の断片も
// 比べやすいよう、空白の並びを 1 つに畳む
function sqlOf(fragment: Prisma.Sql): string {
  return fragment.sql.replace(/\s+/g, ' ').trim()
}

const LIVE = '(deleted_at IS NULL)'
const TEXT = '(memo &@ ? OR url &@ ? OR item_no ILIKE ?)'
const TAG = 'tags @> ARRAY[?]::text[]'
const HAS_TASKS = '((task_todo > 0 OR task_done > 0))'

// 語 1 つが渡すパラメータ (memo・url・itemNo 前方一致の 3 つ)
function textValues(word: string): string[] {
  return [word, word, `${word}%`]
}

describe('buildWhere (検索一覧)', () => {
  test('空クエリはゴミ箱を外すだけ', () => {
    const where = buildWhere('')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE}`)
    expect(where.values).toEqual([])
  })

  test('空白だけのクエリは空クエリと同じ', () => {
    const where = buildWhere(' 　 ')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE}`)
    expect(where.values).toEqual([])
  })

  test('語は memo / url の全文一致と itemNo の前方一致の OR', () => {
    const where = buildWhere('抵抗')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND (${TEXT})`)
    expect(where.values).toEqual(textValues('抵抗'))
  })

  test('itemNo の前方一致は LIKE の特殊文字を逃がす (全文一致には素のまま渡す)', () => {
    const where = buildWhere('a_1%')

    expect(where.values).toEqual(['a_1%', 'a_1%', 'a\\_1\\%%'])
  })

  test('語の値は SQL 文に混ざらずパラメータで渡る', () => {
    const where = buildWhere("x';DROP")

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND (${TEXT})`)
    expect(where.values).toEqual(textValues("x';DROP"))
  })

  test('タグは tags 配列の完全一致で、名前は正規化して渡す', () => {
    const where = buildWhere('#ＮＰＮ')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND (${TAG})`)
    expect(where.values).toEqual(['npn'])
  })

  test('is:todo は未チェックが残っているノート', () => {
    const where = buildWhere('is:todo')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND (task_todo > 0)`)
    expect(where.values).toEqual([])
  })

  test('is:done はチェック済みを持つノート', () => {
    const where = buildWhere('is:done')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND (task_done > 0)`)
  })

  test('is:untagged はタグを 1 つも持たないノート', () => {
    const where = buildWhere('is:untagged')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND (cardinality(tags) = 0)`)
    expect(where.values).toEqual([])
  })

  test('空白の並置は AND で、式全体をもう一段括弧で包む', () => {
    const where = buildWhere('#bjt 1608')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND ((${TAG} AND ${TEXT}))`)
    expect(where.values).toEqual(['bjt', ...textValues('1608')])
  })

  test('OR は AND より弱く結合し、木の入れ子がそのまま括弧になる', () => {
    const where = buildWhere('抵抗 1608 OR コンデンサ')

    expect(sqlOf(where)).toBe(
      `WHERE ${LIVE} AND (((${TEXT} AND ${TEXT}) OR ${TEXT}))`,
    )
    expect(where.values).toEqual([
      ...textValues('抵抗'),
      ...textValues('1608'),
      ...textValues('コンデンサ'),
    ])
  })

  test('否定は NOT で子の式を括弧に包む', () => {
    const where = buildWhere('#bjt !(#npn OR #pnp)')

    expect(sqlOf(where)).toBe(
      `WHERE ${LIVE} AND ((${TAG} AND NOT ((${TAG} OR ${TAG}))))`,
    )
    expect(where.values).toEqual(['bjt', 'npn', 'pnp'])
  })

  test('否定した語 1 つは NOT の括弧に語の条件がそのまま入る', () => {
    const where = buildWhere('!#npn')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND (NOT (${TAG}))`)
    expect(where.values).toEqual(['npn'])
  })

  test('引用した語は OR・タグ・is: に昇格せず、ただの語になる', () => {
    const where = buildWhere('"is:todo" "#tag" "or"')

    expect(sqlOf(where)).toBe(
      `WHERE ${LIVE} AND ((${TEXT} AND ${TEXT} AND ${TEXT}))`,
    )
    expect(where.values).toEqual([
      ...textValues('is:todo'),
      ...textValues('#tag'),
      ...textValues('or'),
    ])
  })

  test('引用の中の空白は語の一部として 1 つのパラメータに入る', () => {
    const where = buildWhere('"2SC1815 GR"')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND (${TEXT})`)
    expect(where.values).toEqual(textValues('2SC1815 GR'))
  })
})

describe('buildTrashedWhere (ゴミ箱)', () => {
  test('空クエリはゴミ箱にある全件', () => {
    const where = buildTrashedWhere('')

    expect(sqlOf(where)).toBe('WHERE (deleted_at IS NOT NULL)')
    expect(where.values).toEqual([])
  })

  test('検索条件は検索一覧と同じ形で、ゴミ箱の条件だけが裏返る', () => {
    const where = buildTrashedWhere('#npn OR 抵抗')

    expect(sqlOf(where)).toBe(
      `WHERE (deleted_at IS NOT NULL) AND ((${TAG} OR ${TEXT}))`,
    )
    expect(where.values).toEqual(['npn', ...textValues('抵抗')])
  })
})

describe('buildPropsWhere (特性表)', () => {
  test('検索条件のあとにプロパティを持つ絞りを足す', () => {
    const where = buildPropsWhere('#npn')

    expect(sqlOf(where)).toBe(
      `WHERE ${LIVE} AND (${TAG}) AND (props <> '[]'::jsonb)`,
    )
    expect(where.values).toEqual(['npn'])
  })

  test('空クエリでもプロパティの絞りは残る', () => {
    const where = buildPropsWhere('')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND (props <> '[]'::jsonb)`)
  })
})

describe('buildChecksWhere (進捗の表)', () => {
  test('最上位が OR の検索でも、チェックを持つ絞りが OR に呑まれない', () => {
    const where = buildChecksWhere('#a OR #b')

    expect(sqlOf(where)).toBe(
      `WHERE ${LIVE} AND ((${TAG} OR ${TAG})) AND ${HAS_TASKS}`,
    )
    expect(where.values).toEqual(['a', 'b'])
  })

  test('空クエリはチェックを持つ全ノート', () => {
    const where = buildChecksWhere('')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND ${HAS_TASKS}`)
  })
})

describe('buildProgressWhere (学習進捗の母数)', () => {
  test('チェック語を外し、チェックを持つノートへ絞る', () => {
    const where = buildProgressWhere('#過渡現象 is:todo')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND (${TAG}) AND ${HAS_TASKS}`)
    expect(where.values).toEqual(['過渡現象'])
  })

  test('チェック語だけの検索は、チェックを持つ全ノートが母数になる', () => {
    const where = buildProgressWhere('is:done')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND ${HAS_TASKS}`)
    expect(where.values).toEqual([])
  })

  test('否定したチェック語は否定ごと落ちる (NOT (無条件) に化けない)', () => {
    const where = buildProgressWhere('#a !is:todo')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND (${TAG}) AND ${HAS_TASKS}`)
    expect(where.values).toEqual(['a'])
  })
})

describe('buildNeighborsWhere (前後ナビ)', () => {
  test('検索条件に今のノート自身を OR で足す', () => {
    const where = buildNeighborsWhere('is:todo', '4551')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE} AND (task_todo > 0 OR item_no = ?)`)
    expect(where.values).toEqual(['4551'])
  })

  test('AND の検索では式の括弧の外に自身の OR が付く', () => {
    const where = buildNeighborsWhere('#a #b', '12')

    expect(sqlOf(where)).toBe(
      `WHERE ${LIVE} AND ((${TAG} AND ${TAG}) OR item_no = ?)`,
    )
    expect(where.values).toEqual(['a', 'b', '12'])
  })

  test('空クエリは全件が対象なので自身を足さない', () => {
    const where = buildNeighborsWhere('', '4551')

    expect(sqlOf(where)).toBe(`WHERE ${LIVE}`)
    expect(where.values).toEqual([])
  })
})

describe('termCondition', () => {
  // 未分類フォルダーの件数 (countFolderTotals) はこの断片を埋め込む。
  // is:untagged 検索の条件と文字どおり同じであることが約束 (docs/86 §5)
  test('未分類の条件は is:untagged 検索と同じ断片', () => {
    const untagged = sqlOf(termCondition({ kind: 'untagged' }))

    expect(untagged).toBe('cardinality(tags) = 0')
    expect(sqlOf(buildWhere('is:untagged'))).toBe(`WHERE ${LIVE} AND (${untagged})`)
  })
})

describe('ALL_CHECKED', () => {
  test('全部チェックしたノートだけを完了に数える', () => {
    expect(sqlOf(ALL_CHECKED)).toBe('(task_done > 0 AND task_todo = 0)')
  })
})

describe('ITEM_COLUMNS', () => {
  test('列を camelCase へ射影する (検索一覧とゴミ箱一覧で共有)', () => {
    expect(sqlOf(ITEM_COLUMNS)).toBe(
      [
        'item_no AS "itemNo"',
        'item_no_num AS "itemNoNum"',
        'memo',
        'url',
        'mode',
        'title',
        'tags',
        'props',
        'task_todo AS "taskTodo"',
        'task_done AS "taskDone"',
        'created_at AS "createdAt"',
        'updated_at AS "updatedAt"',
        'accessed_at AS "accessedAt"',
        'deleted_at AS "deletedAt"',
        'public_at AS "publicAt"',
      ].join(', '),
    )
    expect(ITEM_COLUMNS.values).toEqual([])
  })
})

describe('buildOrderBy', () => {
  test('番号順は prefs/sortOrder.ts の句を ORDER BY に載せる', () => {
    const orderBy = buildOrderBy('itemNo')

    expect(sqlOf(orderBy)).toBe('ORDER BY item_no_num ASC NULLS LAST, item_no ASC')
    expect(orderBy.values).toEqual([])
  })

  test('ゴミ箱の既定は削除の新しい順', () => {
    expect(sqlOf(buildOrderBy('deleted'))).toBe(
      'ORDER BY deleted_at DESC, item_no ASC',
    )
  })
})
