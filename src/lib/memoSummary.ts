// 一覧の要約表示用に、memo の先頭行から Markdown 記法を取り除く。
// 表示専用の簡易変換 (正確なパースは表示側の react-markdown が担う)

import { stripAnswerSpoilers } from './answerSpoiler'
import { RENDERED_LANGS } from './fenceLanguages'
import { readAlertMarker } from './markdownAlerts'

// 行頭の記法: 見出し / 引用 / 箇条書き / 番号リスト / チェックボックス /
// 脚注の定義 (`[^1]: 出典`)
const LINE_PREFIX =
  /^\s*(?:#{1,6}\s+|>\s*|\[\^[^\]]+\]:\s*|(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s*)?)/

// インライン記法 → 中身のテキストだけ残す。
// 単独アンダースコアの強調 (_em_) は部品名 (ABC_DEF) と衝突するため対象外
const INLINE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/!\[([^\]]*)\]\([^)]*\)/g, '$1'], // 画像 → alt テキスト
  [/\[([^\]]*)\]\([^)]*\)/g, '$1'], // リンク → リンクテキスト
  [/(\*\*|__)(.*?)\1/g, '$2'], // 太字
  [/\*(.*?)\*/g, '$1'], // 斜体 (*)
  [/~~(.*?)~~/g, '$1'], // 取り消し線
  [/`([^`]*)`/g, '$1'], // インラインコード
  [/\[\^[^\]]+\]/g, ''], // 脚注の参照 (`本文[^1]`) → 番号ごと落とす
]

// インライン数式 ($...$)。remark-math の解釈の行単位近似で、一覧側の数式の
// 見つけ方はこの 1 本に揃える (マスク・打ち切り・KaTeX 描画・props.ts の
// stripNonProse で別々の正規表現を持つと壊れ方が食い違う)。
//   - 改行は跨がない (数式は行内で閉じる)
//   - \$ エスケープ (通貨。docs/メモ記法.md §数式) は開き・閉じどちらの
//     区切りにもしない。閉じが \$ しか無い式 ($5\$/個$ など) は一致せず
//     生のまま出る — 誤った切り出しで KaTeX に渡すより安全側
//   - 中身は 1 文字以上 ($$ の空一致で本文の $$ を消してしまわない)
export const INLINE_MATH = /(?<!\\)\$[^$\n]+(?<!\\)\$/g

// text 中のインライン数式の範囲 (start は開始 $、end は閉じ $ の次)。
// matchAll は lastIndex を汚さないので共有の正規表現でも安全
export function inlineMathRanges(
  text: string,
): { start: number; end: number }[] {
  return [...text.matchAll(INLINE_MATH)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
  }))
}

// 1 行の中で閉じるブロック数式 ($$x$$)。改行は跨がない — 行を跨ぐ対は
// hiddenLineSkipper の状態機械が行単位で追う。全文への正規表現 1 発だと、
// 無関係な $$ 同士 (散文の $$ とブロックの開き、bash フェンスの echo $$ 等)
// が対になって間の散文ごと消える事故が起きる
// 編集画面のライブプレビュー (mathBlocks.ts) も同じ規則で見つけるため export
// する。判定を書き写すと、一覧では数式なのに編集では生の $$ のまま、という
// 食い違いが出る
export const SINGLE_LINE_BLOCK_MATH = /\$\$.*?\$\$/g

// コードフェンスの区切り行 (```lang / ~~~)。中身ではないので飛ばす。
const FENCE_MARKER = /^\s*(```|~~~)/

// 区切り行の区切り文字と言語トークン (開き行の ```circuitikz など。
// 閉じ行では言語は空文字)
const FENCE_LANG = /^\s*(```|~~~)\s*(\S*)/

// フェンス (```) と行を跨ぐブロック数式 ($$) の開閉を追う行単位の状態機械。
// hiddenLineSkipper (この下) と notePreviewSource (notePreview.ts) が共有する
// 唯一の実装 — INLINE_MATH と同じく「一覧側の見つけ方はこの 1 本に揃える」。
// 別々に持つと、要約が隠した行をプレビューが描く (逆も) 壊れ方になる。
//
// 規則 (remark の行単位の近似。冒頭の「表示専用の簡易変換」の線):
//   - 数式ブロックの中の ``` は TeX の一部。フェンスとして数えない
//   - フェンスの中の $$ (echo $$ など) はブロック数式として扱わない
//   - 行内で閉じる対 ($$x$$) は開閉に数えない。開きは行頭の $$ だけ
//   - 閉じていない $$ / フェンスは本文の末尾まで開いたまま
// 割り切り: 普通のフェンスの中に区切り行そっくりの行 (` ```circuitikz ` の
// 説明書きなど) があると開閉を読み違えるが、isStructureLine も同じ近似で、
// 実害は行選びや見た目がずれるだけ
export interface FenceMathTracker {
  // 行を 1 つ進め、その行の種別を返す。行順に全行を通すこと
  step(line: string): 'marker' | 'fence-body' | 'math' | 'text'
  // 開いているフェンスの区切り文字 (``` / ~~~)。閉じの補完にそのまま使える
  readonly fenceMarker: string | null
  // 開いているフェンスの言語トークン (開いていなければ空文字)
  readonly fenceLang: string
  readonly inMathBlock: boolean
}

export function fenceMathTracker(): FenceMathTracker {
  let fenceMarker: string | null = null
  let fenceLang = ''
  let inMathBlock = false
  return {
    get fenceMarker() {
      return fenceMarker
    },
    get fenceLang() {
      return fenceLang
    },
    get inMathBlock() {
      return inMathBlock
    },
    step(line) {
      const marker = inMathBlock ? null : FENCE_LANG.exec(line)
      if (marker) {
        if (fenceMarker === null) {
          fenceMarker = marker[1]
          fenceLang = marker[2]
          return 'marker'
        }
        if (marker[1] === fenceMarker) {
          fenceMarker = null
          fenceLang = ''
          return 'marker'
        }
        // 別種の区切り (``` の中の ~~~ など) は閉じない。CommonMark も
        // 開きと同じ文字の区切りだけを閉じとして扱う
        return 'fence-body'
      }
      if (fenceMarker !== null) {
        return 'fence-body'
      }
      if (inMathBlock) {
        if (
          line.includes('$$') &&
          line.replace(SINGLE_LINE_BLOCK_MATH, '').includes('$$')
        ) {
          inMathBlock = false
        }
        return 'math'
      }
      if (
        line.includes('$$') &&
        /^\s*\$\$/.test(line.replace(SINGLE_LINE_BLOCK_MATH, ''))
      ) {
        inMathBlock = true
        return 'math'
      }
      return 'text'
    },
  }
}

// 「図やカードに化けてテキストとして表示されない中身」の行を見分ける。
// 対象は描画フェンス (circuitikz / mermaid / quiz) の中身と、行を跨ぐ
// ブロック数式 ($$...$$) の中身 + 区切り行。行順に全行を 1 回ずつ通すこと
// (区切り行も見せないと開閉を追えない)。true を返した行は要約にも
// プレビューにも出さない — TeX やグラフ記法が一覧に流れると見苦しく、
// 図は回路図サムネ (docs/68) として別に見えている。
//
// 普通のコード (bash 等) の中身はノート表示でもテキストとして見えるので通す。
// 開閉の追い方そのものは fenceMathTracker (上) に一本化してある
export function hiddenLineSkipper(): (line: string) => boolean {
  const tracker = fenceMathTracker()
  return (line) => {
    switch (tracker.step(line)) {
      case 'math':
        return true
      case 'fence-body':
        return (RENDERED_LANGS as readonly string[]).includes(tracker.fenceLang)
      default:
        // 区切り行そのものは isStructureLine が落とす (役割を重ねない)
        return false
    }
  }
}

// 折りたたみの区切り行 (`:::details` / `:::`。docs/54-markdown表示拡張計画.md §4)
const DIRECTIVE_MARKER = /^\s*:{3,}/

// 折りたたみのラベル付きの開き行 (`:::details[長いログ]`)。
// **ラベルは書き手が付けた見出しそのもの**なので、囲いとして捨てずに中身として
// 扱う — 捨てると、要約に出るのは折り畳んで隠したはずの 1 行目になる
const DIRECTIVE_LABEL = /^\s*:{3,}[\w-]*\[(.*)\]\s*$/

// 水平線 (`---` / `***` / `___`)。ページとページの境目 (docs/74-ページ計画.md)
// であって見出しではないので、要約にもプレビューにも出さない。
//
// **段落の直後の罫線 (`赤LED` + `------`) はここに来ない。** CommonMark では
// setext 見出しの下線として読まれ、要約は上の行を返して先に抜けるため
// (既存ノートの罫線付きの表がこの形。memoSummary.test.ts で固定してある)
const THEMATIC_BREAK = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/

// 中身ではなく囲い (フェンス・折りたたみ・ページの区切り) の行か。
// 要約もプレビューも同じ判断を使う — 片方だけ直すと一覧の 1 行目と
// その下のプレビューで別の行が選ばれる
export function isStructureLine(line: string): boolean {
  if (DIRECTIVE_LABEL.test(line)) {
    return false
  }
  return (
    FENCE_MARKER.test(line) ||
    DIRECTIVE_MARKER.test(line) ||
    THEMATIC_BREAK.test(line)
  )
}

// 1 行から Markdown 記法を取り除いて表示用のテキストにする。
// memoPreview (一覧の本文プレビュー) も同じ剥がし方を使うので公開している。
// 数式の退避先の目印。本文には現れない置換文字 (props.ts の PLACEHOLDER と
// 同じ選択)。番号で挟む (￼3￼) のは復元を位置合わせに頼らないため —
// リンク剥がしが URL の中の退避印ごと消しても、残った印は自分の数式に戻る
const MATH_MASK_CHAR = '￼'
const MATH_MASK_RE = /￼(\d+)￼/g

export function stripLineMarkdown(line: string): string {
  // 折りたたみのラベルは、囲いを外した中身として扱う
  let text = DIRECTIVE_LABEL.exec(line)?.[1] ?? line
  // 数式の中は TeX であって Markdown ではない。強調・リンク剥がしが
  // $x^*$ を $x^$ に壊すため、先に丸ごと退避して最後に戻す。
  // $ の無い行 (大多数) はこの機構ごと飛ばす
  const maskedMath: string[] = []
  if (text.includes('$')) {
    // 行内で閉じるブロック数式 ($$x$$) は図扱いで丸ごと落とす
    // (hiddenLineSkipper のコメント参照。行を跨ぐ対はあちらが隠す)
    text = text.replace(SINGLE_LINE_BLOCK_MATH, ' ')
    // 本文に元から居る退避印の文字は捨てる (PDF や Word からの貼り付けに
    // 混ざる不可視文字)。残すと復元がその印を数式と取り違える
    text = text.split(MATH_MASK_CHAR).join('')
    text = text.replace(
      INLINE_MATH,
      (math) => `${MATH_MASK_CHAR}${maskedMath.push(math) - 1}${MATH_MASK_CHAR}`,
    )
  }
  // 引用の入れ子 (> > ...) などに備えて、変化しなくなるまで行頭記法を剥がす。
  // アラートの目印 (`> [!NOTE]`) は引用を剥がした後に現れるので同じ輪の中で見る
  for (let prev = ''; prev !== text; ) {
    prev = text
    text = text.replace(LINE_PREFIX, '')
    text = readAlertMarker(text)?.rest ?? text
  }
  for (const [pattern, replacement] of INLINE_PATTERNS) {
    text = text.replace(pattern, replacement)
  }
  // 答え隠し (docs/79-答え隠し計画.md §5) は**中身ごと落とす**。一覧のカードに
  // 訳が出ていたら隠した意味がない。剥がして中身を残す上の記法と向きが違う。
  //
  // 走査は answerSpoiler.ts の 1 本に借りる。ここに同じ正規表現を書くと、
  // 記法の側 (答えに `|` は書けない・改行は跨がない・空は記法と見なさない)
  // を直したときに片方だけ古いままになり、隠した答えがカードに漏れる
  text = stripAnswerSpoilers(text)
  if (maskedMath.length > 0) {
    // リンクや画像の剥がしで印ごと消えた数式 (URL の中に居た物) は
    // 戻らないまま — 消えた文脈と一緒に消えるのが正しい
    text = text.replace(MATH_MASK_RE, (_, i) => maskedMath[Number(i)] ?? '')
  }
  return text.trim()
}

export function memoSummary(memo: string): string {
  // 描画フェンスとブロック数式の中身は要約に使わない (hiddenLineSkipper の
  // コメント参照)。memoPreview も同じ skipper を通す — 片方だけ直すと
  // 一覧の 1 行目とプレビューで別の行が選ばれる (isStructureLine と同じ約束)
  const isHiddenLine = hiddenLineSkipper()
  for (const line of memo.split(/\r?\n/)) {
    if (isHiddenLine(line) || isStructureLine(line)) {
      continue
    }
    const text = stripLineMarkdown(line)
    if (text) {
      return text
    }
  }
  return ''
}
