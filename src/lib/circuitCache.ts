import { prisma } from './db'
import {
  CircuitRenderError,
  assertSafeCircuitSvg,
  circuitHash,
  renderCircuit,
} from './circuitikz'
import { extractCircuitSources } from './circuitFences'

// 1 つのメモで描く回路図の上限。
// 描画は 1 枚ずつ順に行い、1 枚あたり最大 CIRCUIT_TIMEOUT_MS かかる。
// 本文はもう待たない (planCircuits) が、際限なく並べられると 1 回の表示で
// 数十枚ぶんの TeX が走り、本番の 2GB / 3 コアを図だけで埋めてしまう
// (10,000 字あれば数十個書ける)。
// 一覧サムネの取得 (circuitThumbs.ts) も同じ上限で切り、9 個目以降は
// 「描かれない図」なので引きにも行かない
export const MAX_CIRCUITS_PER_MEMO = 8

// 1 つの ```circuitikz フェンスの描画結果。成功か失敗のどちらか
export type CircuitResult = { svg: string } | { error: string; texLog: string }

// 描画結果、または「まだ描いている最中」の約束
// (docs/85-回路図表示待ち計画.md §2)。
//
// 閲覧画面は**描き上がるのを待たずに本文を出す**ため、解けていない約束を
// そのまま置く。図の場所だけが Suspense で「準備中」になる
export type PendingCircuit = CircuitResult | Promise<CircuitResult>

// フェンスの中身 (trim 済み) → 描画結果
export type CircuitMap = ReadonlyMap<string, CircuitResult>

// 同上。描画中の図も置ける版。**CircuitMap はこれに代入できる** ので、
// 描き終わった結果しか持たない画面 (オフライン・一覧サムネ) は
// これまでどおり CircuitMap を渡せばよい
export type PendingCircuitMap = ReadonlyMap<string, PendingCircuit>

// 進行中の描画 (hash → 約束)。**同じ図を 2 度描かない**
// (docs/85-回路図表示待ち計画.md §4)。
//
// DB キャッシュは描き**終わってから**書かれるので、これが無いと同時に来た
// 2 つの要求はどちらもキャッシュミスと判断して同じ図を 2 度描く。描画は
// 直列なので待ち時間もそのぶん倍になる。実際に起きる並びは:
//   - 保存後の先読み (updateMemoAction の after) と、その直後に開かれた閲覧画面
//   - 同じ新しいノートを 2 つのタブ・2 人が同時に開いたとき
const inFlight = new Map<string, Promise<string>>()

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

  // 既に誰かが描いている最中なら、その約束に相乗りする
  const running = inFlight.get(hash)
  if (running) {
    return running
  }

  const pending = renderAndStore(source, hash)
  inFlight.set(hash, pending)
  // 印を消すのは成否によらず。失敗を覚えたままにすると、TeX を直して
  // 描き直せるようになった後も同じ失敗を返し続ける
  return pending.finally(() => inFlight.delete(hash))
}

async function renderAndStore(source: string, hash: string): Promise<string> {
  const svg = await renderCircuit(source)

  // 保存できなくても描けた図は返す (次回また描き直すだけ)。
  // 同じ図を同時に描いたときの主キー衝突もここで無害に流れる
  await prisma.circuitSvg.create({ data: { hash, svg } }).catch(() => undefined)

  return svg
}

// 本文中のすべての ```circuitikz フェンスの描画を**始めるだけ**始めて、
// 図ごとの約束をマップにする。待たない (docs/85-回路図表示待ち計画.md §3)。
//
// 閲覧画面 (ItemView / PublicItemView) はこちらを使う。await すると
// 見出しもタグも本文も、図が描き上がるまで 1 文字も出せない — TeX は
// 1 枚 1〜3 秒かかるので、その間ノートは白いままになる。
//
// **同期に返すのが要点。** 呼んだ時点で描画は走り出しており、React は
// その約束を CircuitDiagram (Suspense) に渡して、解けた図から順に流し込む
export function planCircuits(markdown: string): PendingCircuitMap {
  const sources = extractCircuitSources(markdown)
  const results = new Map<string, PendingCircuit>()

  for (const source of sources.slice(MAX_CIRCUITS_PER_MEMO)) {
    results.set(source, {
      error: `1 つのメモに描ける回路図は ${MAX_CIRCUITS_PER_MEMO} 個までです`,
      texLog: '',
    })
  }

  // node-tikzjax は同時実行できないため、renderCircuit 側のキューに
  // 積まれる。ここでまとめて投げても順に処理される (子プロセスは常に
  // 1 つ = ピーク 400MB のまま。本番は空きが 750MB しかない)
  for (const source of sources.slice(0, MAX_CIRCUITS_PER_MEMO)) {
    results.set(source, renderOne(source))
  }

  return results
}

// 1 枚ぶんの描画。**決して reject しない。**
//
// 1 枚失敗しても他の図とメモ本文は出したいから、というのが元の理由
// (結果に畳んで返す)。加えて planCircuits の約束は誰にも await されない
// まま解けることがある (読者が描き上がる前にページを離れたとき) ので、
// 投げると unhandled rejection でプロセスごと落ちうる
async function renderOne(source: string): Promise<CircuitResult> {
  try {
    return { svg: await getOrRenderCircuit(source) }
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : String(e),
      texLog: e instanceof CircuitRenderError ? e.texLog : '',
    }
  }
}

// 本文中のすべての ```circuitikz フェンスを描画し、描き終わってから返す。
//
// 待ってよい場所だけが使う — オフライン持ち出し (圏外で描けないので先に
// 済ませる) と、保存後の先読み (updateMemoAction の after)。
// **画面を描く経路からは呼ばない** (planCircuits のほうを使う)
export async function renderCircuits(markdown: string): Promise<CircuitMap> {
  const planned = [...planCircuits(markdown)]
  const settled = await Promise.all(
    planned.map(async ([source, pending]) => [source, await pending] as const),
  )
  return new Map(settled)
}
