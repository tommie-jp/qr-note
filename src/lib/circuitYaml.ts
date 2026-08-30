import { VERSION, compileCircuit, finishSvg } from 'circuit-fence/core'
import {
  RENDERER_VERSION,
  assertSafeCircuitSvg,
  circuitHash,
  renderCircuitDocument,
} from './circuitikz'
import { prisma } from './db'
import type { CircuitResult } from './circuitCache'

// 回路 YAML フェンス (docs/91-回路YAMLフェンス計画.md) の描画。
//
// circuit-fence のコアが「YAML → 検証 → circuitikz TeX」までを**同期の純関数**で
// やってくれるので、この層がすることは 3 つだけ:
//
//   1. compileCircuit を通し、読めなければ TeX まで行かずに行番号つきで返す
//   2. 完全な TeX 文書を既存の描画キュー (renderCircuitDocument) へ渡す
//   3. 仕上げ (注釈 → 塗り替え → 外寸 → 刻印) をして検査し、DB に控える

// キャッシュキーに混ぜる版。**2 つ繋ぐ**のが要点 (docs/91 §2)。
//
// レンダラ (node-tikzjax + プリアンブル) が変われば同じ TeX でも SVG が変わり、
// コンパイラ (circuit-fence) が変われば同じ YAML でも TeX が変わる。
// どちらか一方だけを混ぜると、もう片方が動いたときに古い図が返り続ける。
//
// circuitikz フェンスとは版の綴りが違うので、同じ本文が 2 つの言語で書かれても
// 別の行になる (取り違えは起きない)
const YAML_RENDERER_VERSION = `${RENDERER_VERSION}+circuit-fence-${VERSION}`

// フェンスの中身から決まる、キャッシュの主キー
export function circuitYamlHash(source: string): string {
  return circuitHash(source, YAML_RENDERER_VERSION)
}

// 「N 行目: 理由」に整形する。行が分からないもの (図全体に関わる指摘) は
// 行番号を付けずにそのまま出す
function formatFenceError(error: { line: number | null; message: string }): string {
  return error.line === null ? error.message : `${error.line} 行目: ${error.message}`
}

// フェンス 1 つを描く。**投げない** — 呼び出し側 (planCircuits) の約束は
// 誰にも await されないまま解けることがあり、投げるとプロセスごと落ちうる
export async function renderCircuitYaml(source: string): Promise<CircuitResult> {
  const compiled = compileCircuit(source)

  // 読めなかったところがあれば、TeX を 1 秒使う前にここで返す。
  // **行番号は YAML のもの**で、これが circuitikz フェンスに対する取り柄
  if (compiled.errors.length > 0 || compiled.tex === null) {
    return {
      error: compiled.errors.map(formatFenceError).join('\n') || '回路図を組み立てられませんでした',
      texLog: '',
      notices: [],
    }
  }

  // お知らせは書き手が図ごとに伏せられる (`style: debug: off`)。
  // **伏せるのは出す側の仕事** — compileCircuit は伏せた図でも notices を
  // 返し続けるので、ここで落とさないと「出さない」が「無かったことにする」
  // に化ける (circuit-fence の約束 5)
  const notices = compiled.debug
    ? compiled.notices.map((notice) => ({
        line: notice.line,
        message: notice.message,
      }))
    : []

  try {
    const svg = await getOrRenderYamlSvg(source, compiled)
    return { svg, notices }
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : String(e),
      texLog: '',
      notices,
    }
  }
}

type Compiled = ReturnType<typeof compileCircuit>

// 進行中の描画 (hash → 約束)。**同じ図を 2 度描かない** (circuitCache と同じ理由)。
// DB キャッシュは描き終わってから書かれるので、これが無いと同時に来た 2 つの
// 要求はどちらもキャッシュミスと判断して同じ図を 2 度描く
const inFlight = new Map<string, Promise<string>>()

async function getOrRenderYamlSvg(source: string, compiled: Compiled): Promise<string> {
  const hash = circuitYamlHash(source)

  const cached = await prisma.circuitSvg.findUnique({ where: { hash } }).catch(() => null)
  if (cached) {
    // キャッシュ済みも毎回検査する。検査を書き換えたときに版を上げ忘れても
    // 古い行が素通りしないようにするため (circuitCache と同じ)
    return assertSafeCircuitSvg(cached.svg)
  }

  const running = inFlight.get(hash)
  if (running) {
    return running
  }

  const pending = renderAndStore(compiled, hash)
  inFlight.set(hash, pending)
  // 失敗を覚えたままにすると、YAML を直した後も同じ失敗を返し続ける
  return pending.finally(() => inFlight.delete(hash))
}

async function renderAndStore(compiled: Compiled, hash: string): Promise<string> {
  // compileCircuit の TeX は完全な文書。プリアンブルを重ねない (docs/91 §2)
  const raw = await renderCircuitDocument(compiled.tex ?? '')

  // 仕上げの順番には意味があるので core の finishSvg に任せる
  // (注釈の字を差し込む → テーマの色に塗り替える → 外寸 → 刻印)。
  // ここで自前に組み直すと、向こうを直した日に図が食い違う
  const svg = assertSafeCircuitSvg(
    finishSvg(raw, {
      notes: compiled.notes,
      theme: compiled.theme,
      width: compiled.width,
    }),
  )

  // **仕上げた後の SVG を控える。** 注釈も塗り替えも純関数なので、
  // 生のまま控えて読むたびに掛け直しても同じ絵になるが、
  // 引くたびに同じ計算を繰り返す理由がない。
  // 保存できなくても描けた図は返す (次回また描き直すだけ)
  await prisma.circuitSvg.create({ data: { hash, svg } }).catch(() => undefined)

  return svg
}
