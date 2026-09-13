// 画像検索の索引づくり (docs/25-画像検索計画.md §5)。
//
// ゴミ箱を除く全ノートの本文から自前画像を列挙し、埋め込み済みのものだけを
// 集めてクライアントへ渡す。クライアントはこれをカメラフレームのベクトルと
// 総当たりで突き合わせる (照合ロジックは imageSearch.ts)。
//
// 埋め込みは生バイト列を base64 にして運ぶ (JSON に数値配列で入れるより小さい)。
// 1 枚 384 次元 × 4 バイト = 1536 バイト → base64 で約 2KB。千枚でも約 2MB。

import 'server-only'
import { prisma } from './db'
import { allImageNames } from './memoImages'
import { memoSummary } from './memoSummary'

export interface ImageSearchIndexEntry {
  itemNo: string
  // 一覧と同じ要約 (先頭行)。候補表示のラベルに使う。
  title: string
  imageName: string
  // 埋め込みベクトルの生バイト列を base64 にしたもの。
  embedding: string
}

// ノート一覧と「名前→埋め込み base64」から索引を組み立てる純関数。
// 埋め込みが無い画像 (未生成・生成失敗) は載せない = 検索対象から外れる。
export function assembleIndex(
  items: ReadonlyArray<{ itemNo: string; memo: string }>,
  embeddingBase64ByName: ReadonlyMap<string, string>,
): ImageSearchIndexEntry[] {
  const entries: ImageSearchIndexEntry[] = []
  for (const item of items) {
    // 要約が空なら (画像だけのノートなど) 部品番号をラベルにする
    const title = memoSummary(item.memo) || item.itemNo
    for (const imageName of allImageNames(item.memo)) {
      const embedding = embeddingBase64ByName.get(imageName)
      if (!embedding) {
        continue
      }
      entries.push({ itemNo: item.itemNo, title, imageName, embedding })
    }
  }
  return entries
}

// DB から索引を作る。ゴミ箱 (deletedAt 非 null) は除く。
export async function buildImageSearchIndex(): Promise<ImageSearchIndexEntry[]> {
  const items = await prisma.item.findMany({
    where: { deletedAt: null },
    select: { itemNo: true, memo: true },
  })

  // 本文から参照されている画像名をすべて集め、その埋め込みを 1 度に引く。
  const names = new Set<string>()
  for (const item of items) {
    for (const name of allImageNames(item.memo)) {
      names.add(name)
    }
  }
  if (names.size === 0) {
    return []
  }

  const images = await prisma.image.findMany({
    where: { name: { in: [...names] }, embedding: { not: null } },
    select: { name: true, embedding: true },
  })
  const byName = new Map<string, string>()
  for (const img of images) {
    if (img.embedding) {
      byName.set(img.name, Buffer.from(img.embedding).toString('base64'))
    }
  }

  return assembleIndex(items, byName)
}
