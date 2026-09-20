// 実体配線図フェンス (breadboard / perfboard) の描画 (docs/97)。
//
// **ブラウザで描く。** 処理系は DOM も Node も使わない同期の純関数で、1 枚
// 1〜11 ms しか掛からない (実測)。回路図と違って TeX も子プロセスも要らないので、
// サーバの描画キューも DB の控え (circuit_svgs) も API の口も持たない。
// 閲覧・編集のライブプレビュー・オフラインの 3 つが**同じこの関数**を呼ぶ。
//
// 処理系は**使うときに読む** (mermaid と同じ扱い)。1 つ gzip 50KB 前後あるので、
// 実体配線図の無いノートにまで持たせない。

import {
  BREADBOARD_LANG,
  type BoardLang,
  PERFBOARD_LANG,
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

// 処理系の返すものの形。2 つの板で同じ (perfboard だけ erc を別に返す)
interface FenceResult {
  readonly svg: string
  readonly errors: readonly { readonly line: number | null; readonly message: string }[]
  readonly notices: readonly { readonly line: number | null; readonly message: string }[]
  readonly erc?: readonly { readonly line: number | null; readonly message: string }[]
}

type Renderer = (source: string) => FenceResult

// 読み込みは 1 回だけ。畳む / 開くを繰り返しても import は走らない
const loading = new Map<BoardLang, Promise<Renderer>>()

function loadRenderer(lang: BoardLang): Promise<Renderer> {
  const cached = loading.get(lang)
  if (cached) {
    return cached
  }
  const promise =
    lang === BREADBOARD_LANG
      ? import('breadboard-fence/core').then(
          ({ renderBreadboard }): Renderer =>
            (source) => renderBreadboard(source),
        )
      : import('perfboard-fence/core').then(
          ({ renderPerfboard }): Renderer =>
            (source) => renderPerfboard(source),
        )
  loading.set(lang, promise)
  return promise
}

// 言語の綴りから読み込む先を決めるので、知らない語はここまで来ない
const KNOWN: readonly BoardLang[] = [BREADBOARD_LANG, PERFBOARD_LANG]

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
): Promise<BoardRender> {
  if (!KNOWN.includes(lang)) {
    throw new Error(`知らないフェンス言語です: ${lang}`)
  }
  const render = await loadRenderer(lang)
  const result = render(source)
  // 生成物とはいえ、dangerouslySetInnerHTML に無検査で流さない
  // (circuit の SVG と同じ許可リストを通す)
  return { svg: assertSafeSvg(result.svg), issues: issuesOf(result) }
}
