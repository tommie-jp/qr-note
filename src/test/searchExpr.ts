// 検索式 (src/lib/search/) のテストを読みやすくするための AST ビルダ。
// 構文解析 (parse.test.ts) と書き換え (rewrite.test.ts) の両方が同じ形で期待値を書く

import type { SearchExpr, TaskState } from '@/lib/search/types'

export const t = (value: string): SearchExpr => ({
  op: 'term',
  term: { kind: 'text', value },
})
export const tag = (value: string): SearchExpr => ({
  op: 'term',
  term: { kind: 'tag', value },
})
export const and = (...children: SearchExpr[]): SearchExpr => ({ op: 'and', children })
export const or = (...children: SearchExpr[]): SearchExpr => ({ op: 'or', children })
export const not = (child: SearchExpr): SearchExpr => ({ op: 'not', child })

// チェック状態の絞り込み (docs/56-チェック検索計画.md §5)
export const task = (value: TaskState): SearchExpr => ({
  op: 'term',
  term: { kind: 'task', value },
})

// タグの無いノートの絞り込み (docs/86 §5 未分類フォルダー)
export const untagged: SearchExpr = { op: 'term', term: { kind: 'untagged' } }
