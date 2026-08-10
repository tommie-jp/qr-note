// 一覧のノート全体プレビュー (docs/71-一覧ノートプレビュー計画.md) の
// ソース切り詰めと対象判定。描画そのものは components/NotePreviewThumb.tsx。
//
// prisma も react も引き込まない純粋関数の葉 (memoSummary.ts と同じ線)。

import { firstThumbInfo } from './memoImages'
import { fenceMathTracker } from './memoSummary'

// パースへ渡すソースの上限。縮小前の仮想キャンバス (NotePreviewFrame の
// 20rem = 320px 四方) の prose-sm (14px) に見えるのはせいぜい 21 行 ×
// 35 字 ≈ 700 字で、それ以上はパースしても切り捨てられるだけ。KaTeX の
// HTML 膨張 (mathText.ts の予算と同じ事情) もこれで抑える。
//
// 小表示 (40px) は文字が模様にしかならないので、さらに半分に足切りする
// (buildMathTexts が view で title/both を出し分けるのと同じ考え)
export const NOTE_PREVIEW_MAX_SOURCE_CHARS = 600
export const NOTE_PREVIEW_COMPACT_SOURCE_CHARS = 300
export const NOTE_PREVIEW_MAX_LINES = 40

// コードフェンス本体の上限行数。長いログの貼り付けでキャンバスが
// コードだけで埋まらない程度に残す
export const NOTE_PREVIEW_MAX_FENCE_LINES = 8

// 1 レスポンスに作るプレビューの上限件数。searchItems は「さらに表示」で
// 1〜N ページの累積を返すため件数に上限が無い (CIRCUIT_THUMB_BUDGET と同じ
// 事情)。ReactNode はバイト数を測れないので、バイト予算ではなく件数で抑える。
// ソースは上の文字数上限で切ってあるため、件数さえ抑えれば合計も抑まる
export const NOTE_PREVIEW_MAX_ITEMS = 60

// 1 行で閉じるブロック数式の対 (memoSummary.ts と同じ近似)。切り詰めで
// 対が割れていないかの検査に使う
const BLOCK_MATH_PAIR = /\$\$.*?\$\$/g

// 行の途中で切る。2 つの壊し方を避ける:
//   - サロゲートペアの前半を残さない (絵文字が置換文字 (豆腐) になる)
//   - $$...$$ の対を割らない (半端な $$ が後続を数式に見せる)。対ごと捨てる
function sliceAtBudget(line: string, room: number): string {
  let cut = line.slice(0, room)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) {
    cut = cut.slice(0, -1)
  }
  // 完全な対を同じ長さの空白へ退避してから、残った (=対にならない) $$ を探す
  const masked = cut.replace(BLOCK_MATH_PAIR, (pair) => ' '.repeat(pair.length))
  const dangling = masked.lastIndexOf('$$')
  return dangling === -1 ? cut : cut.slice(0, dangling)
}

// プレビュー用に memo の先頭を切り出す。行単位で拾い、フェンス (```) と
// ブロック数式 ($$) の開閉を memoSummary.ts の fenceMathTracker (要約・
// プレビューと同じ 1 本) で追う。途中で切れたら閉じ行を補う — 補わないと、
// 打ち切った尻尾が「フェンスの続き」としてパースされ、プレビュー全体が
// コードに化ける
export function notePreviewSource(
  memo: string,
  maxChars: number = NOTE_PREVIEW_MAX_SOURCE_CHARS,
): string {
  const kept: string[] = []
  let used = 0
  const tracker = fenceMathTracker()
  // 「丸ごと拾えた行」までの開閉状態。予算で行を割った/落としたときは
  // その行の遷移を無かったことにして、ここから閉じを補う — 途中で切れた
  // 閉じ行が状態だけ閉じてしまうと、補いが働かず開きっぱなしになる
  let openFence: string | null = null
  let openMath = false
  let fenceBodyLines = 0

  for (const line of memo.split(/\r?\n/)) {
    if (kept.length >= NOTE_PREVIEW_MAX_LINES) {
      break
    }
    const kind = tracker.step(line)
    if (kind === 'marker') {
      fenceBodyLines = 0
    } else if (kind === 'fence-body') {
      // フェンス本体の超過分は間引く (閉じ行と後続の本文は残す)
      fenceBodyLines++
      if (fenceBodyLines > NOTE_PREVIEW_MAX_FENCE_LINES) {
        continue
      }
    }

    const room = maxChars - used
    if (line.length > room) {
      // 行の途中で予算が尽きた。地の文とコードは切れる分だけ拾う (先頭の
      // 1 行が数千字の貼り付けでも空にならないように)。区切り行と数式の
      // 行は半端に切ると記法ごと壊れるので丸ごと落とす
      if (room > 0 && (kind === 'text' || kind === 'fence-body')) {
        kept.push(sliceAtBudget(line, room))
      }
      break
    }
    kept.push(line)
    used += line.length + 1
    openFence = tracker.fenceMarker
    openMath = tracker.inMathBlock
  }

  if (openMath) {
    kept.push('$$')
  }
  if (openFence !== null) {
    kept.push(openFence)
  }
  return kept.join('\n')
}

// このノートにプレビューを作るか。一覧の顔の優先順位 (画像/動画 → 回路図 →
// プレビュー。ItemRow の thumb 分岐が正本) の 3 段目に届く候補だけ true。
// 回路図サムネの有無はここでは判らない (DB を引いた結果が要る) ので、
// その除外は buildNotePreviews が circuitThumbs を見て行う
export function wantsNotePreview(item: { mode: string; memo: string }): boolean {
  return (
    item.mode !== 'url' &&
    item.memo.trim() !== '' &&
    firstThumbInfo(item.memo) === null
  )
}
