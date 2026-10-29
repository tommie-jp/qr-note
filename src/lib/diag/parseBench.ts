// 回路フェンスの抽出を段階に分けて測る (docs/121 §3-1)。
//
// 本番の経路 (circuit/fences.ts の extractCircuitFences) と同じ部品を、
// sha1 (fenceMemo の鍵) → 解析 (remark で本文全体) → 抽出 (木を辿って回路
// フェンスを拾い、重複を畳む) の順に呼ぶ。本番のコードには計時を足さない —
// 経路を通すことより内訳を見ることを選ぶ。結果が extractCircuitFences と
// 一致することはテストで確かめる。
//
// 記憶 (circuitFencesOf) は**使わず、汚さない**。冷えた値を取るため。
//
// prisma を読まない葉なので、Next の外のスクリプト (scripts/profileParse.ts)
// からも呼べる
import { createHash } from 'node:crypto'
import type { Code, Root } from 'mdast'
import { visit } from 'unist-util-visit'
import { type CircuitFence, circuitKey, isCircuitLang } from '../circuit/fences'
import { uniqueBy } from '../markdown/extractFences'
import { createNoteParser } from '../markdown/parser'

const PARSER = createNoteParser()

export interface ParseStages {
  sha1: number
  解析: number
  抽出: number
}

export const emptyStages = (): ParseStages => ({ sha1: 0, 解析: 0, 抽出: 0 })

export function parseCircuitStaged(
  memo: string,
  now: () => number = () => performance.now(),
): { fences: CircuitFence[]; stages: ParseStages } {
  const t0 = now()
  createHash('sha1').update(memo).digest('base64')
  const t1 = now()
  const tree = PARSER.parse(memo) as Root
  const t2 = now()
  const found: CircuitFence[] = []
  visit(tree, 'code', (node: Code) => {
    const source = node.value.trim()
    if (isCircuitLang(node.lang) && source !== '') {
      found.push({ lang: node.lang, source })
    }
  })
  const fences = uniqueBy(found, (fence) => circuitKey(fence.lang, fence.source))
  const t3 = now()
  return { fences, stages: { sha1: t1 - t0, 解析: t2 - t1, 抽出: t3 - t2 } }
}

// 本文の並びを 1 回ずつ解析し、段階ごとの合計を返す。
// yieldEvery 件ごとに順番を譲る (解析はイベントループを塞ぐ。syncItems.ts の
// PARSE_YIELD_EVERY と同じ考え)
export async function parseBatch(
  memos: readonly string[],
  { now = () => performance.now(), yieldEvery = 1 }: { now?: () => number; yieldEvery?: number } = {},
): Promise<{ totalMs: number; stages: ParseStages; fences: number }> {
  let stages = emptyStages()
  let fences = 0
  for (const [index, memo] of memos.entries()) {
    const one = parseCircuitStaged(memo, now)
    stages = {
      sha1: stages.sha1 + one.stages.sha1,
      解析: stages.解析 + one.stages.解析,
      抽出: stages.抽出 + one.stages.抽出,
    }
    fences += one.fences.length
    if ((index + 1) % yieldEvery === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }
  // 全体は段階の和。譲った待ち (ほかの要求の処理) は入れない
  return { totalMs: stages.sha1 + stages.解析 + stages.抽出, stages, fences }
}
