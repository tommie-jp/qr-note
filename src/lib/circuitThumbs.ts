// 検索一覧 (小/大/画像) に出す回路図サムネの取得
// (docs/68-一覧回路図サムネ計画.md)。
//
// **描画はしない。** circuit_svgs にキャッシュ済みの SVG を引くだけで、
// 未描画の図は黙って飛ばす (ノートを開けば描かれて次から出る)。描画は 1 枚
// 最大 10 秒かかるため、一覧の表示に混ぜられない — オフライン同期の口が
// 描かないのと同じ理由 (syncItems.ts の loadOfflineCircuits)。
//
// このモジュールは prisma を引き込むサーバ専用。client component からは
// 値を import しないこと (型だけなら可。offline/circuits.ts と同じ線引き)
import { prisma } from './db'
import { MAX_CIRCUITS_PER_MEMO } from './circuitCache'
import { assertSafeCircuitSvg, circuitHash } from './circuitikz'
import { CIRCUIT_LANG, extractCircuitSources } from './circuitFences'
import { firstThumbInfo } from './memoImages'

// itemNo → インライン SVG (本文の出現順)。小/大は先頭 1 枚、画像モードは全部。
// サーバ→クライアント境界を越える prop なので Map ではなく素の Record
export type CircuitThumbMap = Record<string, string[]>

// first … 小/大のサムネ用。画像サムネの無いノートに 1 枚だけ
// all   … 画像モードのタイル用。ノートの図を全部 (画像タイルと併記)
export type CircuitThumbMode = 'first' | 'all'

// SVG 1 枚の上限。実測は数 KB (平均 2.9KB) で、これを大きく超える図は
// サムネにするには複雑すぎる。インライン埋め込みなのでページ重量に直結する
export const MAX_CIRCUIT_THUMB_BYTES = 32 * 1024

// 1 レスポンスに埋め込む SVG の合計予算。searchItems は「さらに表示」で
// 1〜N ページの累積を返すため、件数はページを送るほど増える。一覧の先頭から
// 詰めて、超過した分は黙って落とす (前例: オフラインの OFFLINE_CIRCUIT_BUDGET)。
//
// **線上は約 2 倍になる前提の値。** ItemList は client component なので、
// SVG は SSR した HTML と hydration 用の Flight payload の両方に載る。
// 重複部分が 32KB より離れると gzip の窓にも収まらない。実測の SVG は
// 平均 2.9KB なので、この予算でも普段は数十 KB で収まる
export const CIRCUIT_THUMB_BUDGET = 256 * 1024

// 一覧に必要な列だけに絞る (Item を丸ごと要求しない)。テストも軽くなる
type ThumbSource = { itemNo: string; memo: string; mode: string }

// ページ内アイテムの回路図サムネをまとめて引く。
// 対象が無ければクエリ 0 回。DB エラー・検査 NG・未描画は全て
// 「サムネなし」へ静かに畳む — 回路図はおまけで、一覧本体を道連れにしない
export async function loadCircuitThumbs(
  items: readonly ThumbSource[],
  mode: CircuitThumbMode,
): Promise<CircuitThumbMap> {
  // 足切り: remark のパース (extractCircuitSources) は安くないので、
  // フェンスの気配が無いノートは文字列検索だけで外す (syncItems と同じ)。
  // first では画像サムネを持つノートも外す — 一覧の顔は画像が優先で、
  // 引いても使われない (優先順位の正本は ItemRow の thumb 分岐)
  const wants = items.flatMap((item) => {
    if (item.mode === 'url' || !item.memo.includes(CIRCUIT_LANG)) {
      return []
    }
    if (mode === 'first' && firstThumbInfo(item.memo) !== null) {
      return []
    }
    // 9 個目以降は描画側 (renderCircuits) が描かないので引きにも行かない
    const sources = extractCircuitSources(item.memo).slice(
      0,
      MAX_CIRCUITS_PER_MEMO,
    )
    if (sources.length === 0) {
      return []
    }
    return [{ itemNo: item.itemNo, hashes: sources.map((s) => circuitHash(s)) }]
  })
  if (wants.length === 0) {
    return {}
  }

  // ページぶんを 1 クエリで引く (hash は主キー)。同じ図が複数ノートに
  // あっても 1 回で済むよう重複を除く
  const uniqueHashes = [...new Set(wants.flatMap((w) => w.hashes))]
  const rows = await prisma.circuitSvg
    .findMany({
      where: { hash: { in: uniqueHashes } },
      select: { hash: true, svg: true },
    })
    .catch((error) => {
      // 一覧は出す (サムネなしに劣化) が、恒久的なクエリ失敗が
      // 「回路図が静かに全部消えた」にならないよう痕跡は残す
      // (syncItems.ts の loadOfflineCircuits と同じ作法)
      console.warn('一覧用の回路図サムネを引けませんでした', error)
      return []
    })

  const svgByHash = new Map<string, string>()
  for (const row of rows) {
    // キャッシュ済みでも毎回検査してから埋め込む (getOrRenderCircuit と
    // 同じ作法)。通らない図と 1 枚上限を超える図は無かったことにする
    try {
      const svg = assertSafeCircuitSvg(row.svg)
      if (Buffer.byteLength(svg) <= MAX_CIRCUIT_THUMB_BYTES) {
        svgByHash.set(row.hash, svg)
      }
    } catch {
      // 検査 NG。ノートを開けば同じ検査がエラー表示として面倒を見る
    }
  }

  const map: CircuitThumbMap = {}
  let budget = CIRCUIT_THUMB_BUDGET
  for (const want of wants) {
    const svgs: string[] = []
    let exhausted = false
    for (const hash of want.hashes) {
      const svg = svgByHash.get(hash)
      if (svg === undefined) {
        continue
      }
      // 予算切れは打ち止め (一覧の後ろのページほど図が出なくなるだけ)。
      // 入りきった分は捨てずに出す — ここで即 return すると、この項目の
      // 収集済みの図まで消えて「先頭から詰める」の約束が崩れる
      if (Buffer.byteLength(svg) > budget) {
        exhausted = true
        break
      }
      budget -= Buffer.byteLength(svg)
      svgs.push(svg)
      if (mode === 'first') {
        break
      }
    }
    if (svgs.length > 0) {
      map[want.itemNo] = svgs
    }
    if (exhausted) {
      break
    }
  }
  return map
}
