// 本文から特定の言語のフェンスを取り出す (回路図・進捗の表・健康グラフで共有)。
//
// 正規表現ではなく remark でパースするのは、フェンスの入れ子や
// インデントの解釈を react-markdown 側と必ず一致させるため
// (ズレると描画済みの図や集計済みの表を引けず、コードブロックのまま出てしまう)。
// そのため読む列も描画側と同じ createNoteParser を使う。素の remark-parse で
// 読んでいた頃は、描画では数式になる `$$` の中のフェンスを図として拾い、
// 描画では図になる脚注の字下げの中のフェンスを見落としていた (2026-09-17 に修正)。
//
// DB もセッションも持ち込まない葉モジュールにしておく。取り出した文字列が
// そのまま描画結果の鍵になるので、その一致を DB 無しでテストしたい
// (health/healthFences.ts の冒頭コメント)

import type { Code, Root } from 'mdast'
import { visit } from 'unist-util-visit'
import { createNoteParser } from './parser'

// 描画側と同じ列で凍結したパーサ (parse だけ使う。変換は要らない)
const NOTE_PARSER = createNoteParser()

// 取り出した 1 つのフェンス。source は trim 済み
export interface Fence<L extends string = string> {
  readonly lang: L
  readonly source: string
}

// 言語が isTarget を満たすフェンスを**本文に出てくる順**ですべて返す。
// 重複も空の中身もそのまま残す — 畳み方 (鍵に言語を混ぜるか、空を捨てるか) は
// 呼び出し側ごとに違うので、ここでは決めない
export function extractFences<L extends string>(
  markdown: string,
  isTarget: (lang: Code['lang']) => lang is L,
): Fence<L>[] {
  const tree = NOTE_PARSER.parse(markdown) as Root
  const fences: Fence<L>[] = []

  visit(tree, 'code', (node: Code) => {
    const nodeLang = node.lang
    if (!isTarget(nodeLang)) {
      return
    }
    fences.push({ lang: nodeLang, source: node.value.trim() })
  })

  return fences
}

// 言語 lang のフェンスの中身を重複なしで、本文に出てくる順に返す。
// 中身が空でも捨てない (鍵は '' になる)。matrix も health も
// 「検索式なし = 絞り込みなし」で描けるため
export function extractFenceSources(markdown: string, lang: string): string[] {
  const isLang = (candidate: Code['lang']): candidate is string =>
    candidate === lang
  return uniqueBy(
    extractFences(markdown, isLang).map((fence) => fence.source),
    (source) => source,
  )
}

// 鍵が同じものは最初の 1 つだけ残す (順は保つ)
export function uniqueBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = keyOf(item)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
