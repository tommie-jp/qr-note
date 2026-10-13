// 実体配線図 (breadboard / perfboard) と計器の画面・寸法図 (vna・scope・spectrum・
// graph・logic・copper) のフェンスの描画 (docs/97・docs/103)。
//
// **ブラウザで描く。** 処理系は DOM も Node も使わない同期の純関数で、1 枚
// 1〜11 ms しか掛からない (実測)。回路図と違って TeX も子プロセスも要らないので、
// サーバの描画キューも DB の控え (circuit_svgs) も API の口も持たない。
// 閲覧・編集のライブプレビュー・オフラインの 3 つが**同じこの関数**を呼ぶ。
//
// 処理系は**使うときに読む** (mermaid と同じ扱い)。1 つ gzip 50KB 前後あるので、
// 実体配線図の無いノートにまで持たせない。
//
// `data:` を持つ 4 つ (vna・scope・spectrum・graph) は、測った値を**同期の関数**
// (名前 → 本文の文字列) で受ける。その元は同じメモの添付で、取りに行くのは
// 呼ぶ側 (BoardDiagram)。ここは渡された関数をそのまま処理系へ渡すだけ。

import {
  BREADBOARD_LANG,
  type BoardLang,
  COPPER_LANG,
  GRAPH_LANG,
  LOGIC_LANG,
  PERFBOARD_LANG,
  SCOPE_LANG,
  SPECTRUM_LANG,
  VNA_LANG,
} from './fenceLanguages'
import { assertSafeSvg } from './safeSvg'

// 図の下に出す 1 行。処理系の返す errorHtml (生の HTML) は使わない —
// 独自の class が付いた <div> で、SVG の検査も掛からない。
// **配列から画面側で組む** (React が字を逃がす)
export interface BoardIssue {
  // Markdown の行番号。図全体に関わるものは null
  readonly line: number | null
  readonly message: string
  // 読めなかった行 (false) か、読めてはいるが伝えたいこと (true) か
  readonly notice: boolean
}

export interface BoardRender {
  // 外部リソースを参照しない完結した SVG。検査済み
  readonly svg: string
  readonly issues: readonly BoardIssue[]
}

// `data:` の名前から本文を返す関数 (上流の DataSource と同じ形)。無ければ null
export type DataLookup = (name: string) => string | null

export interface BoardRenderOptions {
  readonly data?: DataLookup
}

// 処理系の返すものの形。どれも同じ (perfboard と copper だけ erc を別に返す)
interface FenceResult {
  readonly svg: string
  readonly errors: readonly { readonly line: number | null; readonly message: string }[]
  readonly notices: readonly { readonly line: number | null; readonly message: string }[]
  readonly erc?: readonly { readonly line: number | null; readonly message: string }[]
}

type Renderer = (source: string, options: BoardRenderOptions) => FenceResult

// 読み込みは 1 回だけ。畳む / 開くを繰り返しても import は走らない
const loading = new Map<BoardLang, Promise<Renderer>>()

function loadRenderer(lang: BoardLang): Promise<Renderer> {
  const cached = loading.get(lang)
  if (cached) {
    return cached
  }
  const promise = importRenderer(lang)
  loading.set(lang, promise)
  return promise
}

// 動的 import は**リテラルの指定子**でなければ束ねられない。言語ごとに 1 つずつ書く
function importRenderer(lang: BoardLang): Promise<Renderer> {
  switch (lang) {
    case BREADBOARD_LANG:
      return import('breadboard-fence/core').then(
        ({ renderBreadboard }): Renderer => (source) => renderBreadboard(source),
      )
    case PERFBOARD_LANG:
      return import('perfboard-fence/core').then(
        ({ renderPerfboard }): Renderer => (source) => renderPerfboard(source),
      )
    case VNA_LANG:
      return import('vna-fence/core').then(
        ({ renderVna }): Renderer => (source, { data }) => renderVna(source, { data }),
      )
    case SCOPE_LANG:
      return import('scope-fence/core').then(
        ({ renderScope }): Renderer => (source, { data }) => renderScope(source, { data }),
      )
    case SPECTRUM_LANG:
      return import('spectrum-fence/core').then(
        ({ renderSpectrum }): Renderer =>
          (source, { data }) => renderSpectrum(source, { data }),
      )
    case GRAPH_LANG:
      return import('graph-fence/core').then(
        ({ renderGraph }): Renderer => (source, { data }) => renderGraph(source, { data }),
      )
    case LOGIC_LANG:
      return import('logic-fence/core').then(
        ({ renderLogic }): Renderer => (source) => renderLogic(source),
      )
    case COPPER_LANG:
      return import('copper-fence/core').then(
        ({ renderCopper }): Renderer => (source) => renderCopper(source),
      )
    default:
      return Promise.reject(new Error(`知らないフェンス言語です: ${String(lang)}`))
  }
}

function issuesOf(result: FenceResult): BoardIssue[] {
  // **読めなかった行を先に。** お知らせ (ERC を含む) は足 1 本につき 1 件出る
  // ことがあり、行順に混ぜると直さないと図が出ないほうが下に埋もれる
  return [
    ...result.errors.map((one) => ({ ...one, notice: false })),
    ...result.notices.map((one) => ({ ...one, notice: true })),
    ...(result.erc ?? []).map((one) => ({ ...one, notice: true })),
  ]
}

/**
 * フェンス 1 つを図にする。**投げるのは処理系が壊れているときだけ** —
 * 読めない本文は図と `issues` の組で返る (板は既定を持つので必ず描ける)。
 */
export async function renderBoardFence(
  lang: BoardLang,
  source: string,
  options: BoardRenderOptions = {},
): Promise<BoardRender> {
  const render = await loadRenderer(lang)
  const result = render(source, options)
  // 生成物とはいえ、dangerouslySetInnerHTML に無検査で流さない
  // (circuit の SVG と同じ許可リストを通す)
  return { svg: assertSafeSvg(result.svg), issues: issuesOf(result) }
}
