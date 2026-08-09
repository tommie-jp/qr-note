import { prisma } from './db'
import {
  CircuitRenderError,
  assertSafeCircuitSvg,
  circuitHash,
  renderCircuit,
} from './circuitikz'
import { extractCircuitSources } from './circuitFences'

// 1 つのメモで描く回路図の上限。
// 描画は 1 枚ずつ順に行い、1 枚あたり最大 CIRCUIT_TIMEOUT_MS かかるため、
// 際限なく並べられるとページ表示がその分だけ止まる (10,000 字あれば数十個書ける)。
// 一覧サムネの取得 (circuitThumbs.ts) も同じ上限で切り、9 個目以降は
// 「描かれない図」なので引きにも行かない
export const MAX_CIRCUITS_PER_MEMO = 8

// 1 つの ```circuitikz フェンスの描画結果。成功か失敗のどちらか
export type CircuitResult = { svg: string } | { error: string; texLog: string }

// フェンスの中身 (trim 済み) → 描画結果
export type CircuitMap = ReadonlyMap<string, CircuitResult>

// ```circuitikz フェンスを SVG にする。描画は 1 秒強かかるので DB にキャッシュし、
// 2 回目以降は引くだけにする。
//
// キャッシュはあくまで派生データ (消えても再描画できる) なので、DB の
// 読み書きに失敗しても図は出す。描画そのものの失敗だけは呼び出し元へ投げる
export async function getOrRenderCircuit(source: string): Promise<string> {
  const hash = circuitHash(source)

  const cached = await prisma.circuitSvg
    .findUnique({ where: { hash } })
    .catch(() => null)
  if (cached) {
    // キャッシュ済みの SVG も毎回検査する。検査を書き換えたときに
    // RENDERER_VERSION を上げ忘れても、古い行が素通りしないようにするため
    // (検査は数 KB の文字列走査なのでキャッシュヒットの速さは損なわない)
    return assertSafeCircuitSvg(cached.svg)
  }

  const svg = await renderCircuit(source)

  // 保存できなくても描けた図は返す (次回また描き直すだけ)。
  // 同じ図を同時に描いたときの主キー衝突もここで無害に流れる
  await prisma.circuitSvg.create({ data: { hash, svg } }).catch(() => undefined)

  return svg
}

// 本文中のすべての ```circuitikz フェンスを描画してマップにする。
// MarkdownView は同期に描くため、非同期の描画はページ側でここを await して
// 済ませ、結果を prop で渡す。
//
// 1 枚失敗しても他の図とメモ本文は出したいので、失敗はマップに畳んで返す
// (投げ返さない)
export async function renderCircuits(markdown: string): Promise<CircuitMap> {
  const sources = extractCircuitSources(markdown)
  const results = new Map<string, CircuitResult>()

  for (const source of sources.slice(MAX_CIRCUITS_PER_MEMO)) {
    results.set(source, {
      error: `1 つのメモに描ける回路図は ${MAX_CIRCUITS_PER_MEMO} 個までです`,
      texLog: '',
    })
  }

  // node-tikzjax は同時実行できないため、renderCircuit 側のキューに
  // 積まれる。ここで並列に投げても順に処理される
  for (const source of sources.slice(0, MAX_CIRCUITS_PER_MEMO)) {
    try {
      results.set(source, { svg: await getOrRenderCircuit(source) })
    } catch (e) {
      results.set(source, {
        error: e instanceof Error ? e.message : String(e),
        texLog: e instanceof CircuitRenderError ? e.texLog : '',
      })
    }
  }

  return results
}
