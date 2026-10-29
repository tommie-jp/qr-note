// 検索一覧 (小/大/画像) に出す回路図サムネの取得
// (docs/68-一覧回路図サムネ計画.md)。
//
// **返すのは SVG の hash だけ** (docs/124 §1)。SVG の中身は
// /api/circuits/svg/<hash> が配り、端末は immutable で覚える。一覧の応答に
// 埋め込んでいた頃は、回路図の多い検索 (オペアンプ) の 500KB のほとんどが SVG で、
// 同じ図を検索のたびに運び直していた。
//
// **描画はしない。** circuit_svgs にキャッシュ済みの SVG を引くだけで、
// 未描画の図は黙って飛ばす (ノートを開けば描かれて次から出る)。描画は 1 枚
// 最大 10 秒かかるため、一覧の表示に混ぜられない — オフライン同期の口が
// 描かないのと同じ理由 (syncItems.ts の loadOfflineCircuits)。
//
// このモジュールは prisma を引き込むサーバ専用。client component からは
// 値を import しないこと。返り値の型 (CircuitThumbMap) は葉の
// circuit/types.ts に置いてあり、表示側はそちらを import する
import 'server-only'
import { prisma } from '../db'
import { circuitHash } from './hash'
import { type CircuitThumbMap, MAX_CIRCUITS_PER_MEMO } from './types'
import { CIRCUITIKZ_LANG, type CircuitFence } from './fences'
import { circuitFencesOfMany } from './fenceStore'
import { circuitYamlHash } from './yaml'
import { firstThumbInfo } from '../images/memoImages'

// first … 小/大のサムネ用。画像サムネの無いノートに 1 枚だけ
// all   … 画像モードのタイル用。ノートの図を全部 (画像タイルと併記)
export type CircuitThumbMode = 'first' | 'all'

// SVG 1 枚の上限。実測は数 KB (平均 2.9KB) で、これを大きく超える図は
// サムネにするには複雑すぎる (行の 24〜96px では線が潰れる)
export const MAX_CIRCUIT_THUMB_BYTES = 32 * 1024

// 一覧に必要な列だけに絞る (Item を丸ごと要求しない)。テストも軽くなる
type ThumbSource = { itemId: string; memo: string }

// フェンス 1 つの DB 主キー。**言語ごとに版の混ぜ方が違う** — YAML は
// レンダラの版に circuit-fence の版も繋ぐ (docs/91 §2)。ここを取り違えると
// 引きに行く鍵が描画側とずれ、サムネだけ永久に出ない
const hashOfFence = (fence: CircuitFence): string =>
  fence.lang === CIRCUITIKZ_LANG
    ? circuitHash(fence.source)
    : circuitYamlHash(fence.source)

// ページ内アイテムの回路図サムネをまとめて引く。
// 対象が無ければクエリ 0 回。DB エラー・検査 NG・未描画は全て
// 「サムネなし」へ静かに畳む — 回路図はおまけで、一覧本体を道連れにしない
export async function loadCircuitThumbs(
  items: readonly ThumbSource[],
  mode: CircuitThumbMode,
): Promise<CircuitThumbMap> {
  // 足切り: first では画像サムネを持つノートも外す — 一覧の顔は画像が優先で、
  // 引いても使われない (優先順位の正本は lib/items/itemRowDecor.ts の rowFace)。
  // 回路の言語名を含まないノートは circuitFencesOfMany が引きにも行かずに外す
  const candidates = items.filter(
    (item) => !(mode === 'first' && firstThumbInfo(item.memo) !== null),
  )
  // 取り出しは DB の控えから (docs/122 §1)。控えに無い本文だけを解析する。
  // 追加読み込みは 1〜N ページを描き直すので、控えが無いと同じノートを毎回解析し直す
  const fencesByItem = await circuitFencesOfMany(candidates.map((item) => item.memo))
  const wants = candidates.flatMap((item, index) => {
    // 9 個目以降は描画側 (planCircuits) が描かないので引きにも行かない。
    // **上限は 2 言語の合算**なので、切るのも 1 本に並べた後 (docs/91 §4)
    const fences = fencesByItem[index].slice(0, MAX_CIRCUITS_PER_MEMO)
    if (fences.length === 0) {
      return []
    }
    return [{ itemId: item.itemId, hashes: fences.map(hashOfFence) }]
  })
  if (wants.length === 0) {
    return {}
  }

  // ページぶんを 1 クエリで引く (hash は主キー)。同じ図が複数ノートに
  // あっても 1 回で済むよう重複を除く
  const uniqueHashes = [...new Set(wants.flatMap((w) => w.hashes))]
  // 中身は引かない。描画済みかと大きさだけを見る (安全検査は配る口で掛ける)
  const rows = await prisma.$queryRaw<{ hash: string; bytes: number }[]>`
    SELECT hash, octet_length(svg)::int AS bytes
    FROM circuit_svgs
    WHERE hash = ANY(${uniqueHashes})
  `.catch((error: unknown) => {
    console.warn('一覧用の回路図サムネを引けませんでした', error)
    return []
  })
  const usable = new Set(
    rows.filter((row) => row.bytes <= MAX_CIRCUIT_THUMB_BYTES).map((row) => row.hash),
  )

  const map: CircuitThumbMap = {}
  for (const want of wants) {
    const hashes = want.hashes.filter((hash) => usable.has(hash))
    const picked = mode === 'first' ? hashes.slice(0, 1) : hashes
    if (picked.length > 0) {
      map[want.itemId] = picked
    }
  }
  return map
}
