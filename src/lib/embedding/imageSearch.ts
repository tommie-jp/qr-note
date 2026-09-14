// 画像検索の照合ロジック (docs/25-画像検索計画.md §1,6)。
//
// クエリ (カメラフレーム) の埋め込みと、登録済み画像の埋め込みを総当たりで
// 突き合わせ、ノート単位の類似度に集約して上位を返す。純粋な計算だけを置く
// (ベクトルの取得やモデル推論は含めない)。数千件規模なら総当たりで数 ms。

import { dot } from './imageVector'

// 索引 1 件 = 1 枚の登録画像。1 ノートに複数枚あれば同じ itemNo で複数並ぶ。
// embedding は正規化済み Float32Array。
export interface ImageVectorEntry {
  itemNo: string
  title: string
  imageName: string
  embedding: Float32Array
}

// ノート 1 件分の照合結果。imageName は最も似ていた 1 枚 (サムネ表示に使う)。
export interface ItemMatch {
  itemNo: string
  title: string
  imageName: string
  score: number
}

export interface RankOptions {
  // 返す最大件数。既定 5。
  limit?: number
  // これ未満のスコアは捨てる (cosine なので -1〜1)。既定 0 = 足切りなし。
  minScore?: number
}

const DEFAULT_LIMIT = 5

// クエリベクトルに近いノートを上位から返す。
//
// ノートのスコアは所属画像の最大類似度で集約する (角度違いの複数枚を登録し、
// どれか 1 枚が似ていれば当たり、とする定石。docs/25 §6)。同点は itemNo 昇順で
// 安定させる (端末やデータ順に依らず同じ結果を返す)。
export function rankItems(
  query: Float32Array,
  entries: ImageVectorEntry[],
  options: RankOptions = {},
): ItemMatch[] {
  const limit = options.limit ?? DEFAULT_LIMIT
  const minScore = options.minScore ?? 0

  // itemNo ごとに最大スコアと、それを出した画像を持つ。
  const best = new Map<string, ItemMatch>()
  for (const entry of entries) {
    const score = dot(query, entry.embedding)
    const current = best.get(entry.itemNo)
    if (!current || score > current.score) {
      best.set(entry.itemNo, {
        itemNo: entry.itemNo,
        title: entry.title,
        imageName: entry.imageName,
        score,
      })
    }
  }

  return [...best.values()]
    .filter((match) => match.score >= minScore)
    .sort((a, b) => b.score - a.score || (a.itemNo < b.itemNo ? -1 : 1))
    .slice(0, limit)
}

// 上位候補が「はっきり 1 位」と言えるかの目安 (docs/25 §6)。
// 1 位と 2 位のスコア差が十分あるときだけ確信ありとする。絶対しきい値は
// 環境差が大きいので、差分と併用して頑健にする。候補が 1 件以下なら判定不能。
export function isConfident(
  matches: ItemMatch[],
  minGap: number,
): boolean {
  if (matches.length === 0) {
    return false
  }
  if (matches.length === 1) {
    return true
  }
  return matches[0].score - matches[1].score >= minGap
}
