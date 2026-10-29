// フェンスの抽出が、描画の parser (remark-gfm あり) と抽出用の parser
// (remark-gfm なし) で全ノート一致するかを確かめる (docs/122 §2)。読むだけ。
//
// 回路 (circuit・circuitikz) に限らず、全言語のフェンスの「言語と中身」の並びを
// 比べる (matrix・health も同じ抽出の道を通るため)。1 件でも違えば終了コード 1。
//
// 使い方: npx tsx --conditions=react-server scripts/checkFenceParsers.ts
import 'dotenv/config'
import type { Code, Root } from 'mdast'
import { visit } from 'unist-util-visit'
import { prisma } from '@/lib/db'
import { createFenceParser, createNoteParser } from '@/lib/markdown/parser'

const NOTE = createNoteParser()
const FENCE = createFenceParser()

function fencesOf(parser: typeof NOTE, memo: string): string[] {
  const out: string[] = []
  visit(parser.parse(memo) as Root, 'code', (node: Code) => {
    out.push(`${node.lang ?? ''}\u0000${node.value}`)
  })
  return out
}

async function main(): Promise<void> {
  const items = await prisma.item.findMany({ select: { itemId: true, memo: true } })
  let mismatched = 0
  let fences = 0
  let noteMs = 0
  let fenceMs = 0
  for (const item of items) {
    const t0 = performance.now()
    const a = fencesOf(NOTE, item.memo)
    const t1 = performance.now()
    const b = fencesOf(FENCE, item.memo)
    const t2 = performance.now()
    noteMs += t1 - t0
    fenceMs += t2 - t1
    fences += a.length
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
      mismatched += 1
      console.log(`不一致: ${item.itemId} (描画 ${a.length} 個 / 抽出 ${b.length} 個)`)
    }
  }
  console.log(`${items.length} 件・フェンス ${fences} 個を比べた。不一致 ${mismatched} 件`)
  console.log(`解析の合計: 描画の parser ${noteMs.toFixed(0)}ms / 抽出の parser ${fenceMs.toFixed(0)}ms`)
  if (mismatched > 0) {
    process.exitCode = 1
  }
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
