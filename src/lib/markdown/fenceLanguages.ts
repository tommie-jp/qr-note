// フェンス言語まわりの単一ソース。
// エディタ (client) からも読むため、remark/mdast などの重い依存は持たない
// 葉モジュールにしている (circuitFences はここから CIRCUITIKZ_LANG を re-export する)。

// 特別に図として描画するフェンス言語。
// 回路図は素の TeX を書く circuitikz と、YAML を書く circuit (docs/91) の
// 2 つがある。名前を実体に合わせてあるのは、後から足すほうを CIRCUIT_LANG に
// したときに「どちらの回路フェンスか」を読み違えないため
export const CIRCUITIKZ_LANG = 'circuitikz'

// 回路図を YAML で書くフェンス (docs/91-回路YAMLフェンス計画.md)。
// circuitikz の上位互換ではなく**別の言語**で、2 つは共存する
// (TeX を直に書きたい図があり、既存ノートは全部そちらで書かれている)
export const CIRCUIT_LANG = 'circuit'

// 回路図になるフェンスの一覧と、描画結果を引くときの鍵。
// **葉モジュールに置く** — 閲覧 (MarkdownView) とエディタの両方が鍵を作るので、
// remark を抱えた circuitFences に置くと client のバンドルへ引きずり込む
export const CIRCUIT_LANGS = [CIRCUITIKZ_LANG, CIRCUIT_LANG] as const
export type CircuitLang = (typeof CIRCUIT_LANGS)[number]

// unknown を受けるのは、API の本文など**外から来た値**をそのまま渡せるように
// するため。呼び分けの前に形を確かめる場所を 1 つにしておく
export function isCircuitLang(lang: unknown): lang is CircuitLang {
  return CIRCUIT_LANGS.some((candidate) => candidate === lang)
}

// 描画結果を引く鍵。**言語を混ぜる**のが要点 — 同じ文字列が 2 つの言語で
// 書かれても別の図なので、本文だけを鍵にすると片方の図がもう片方の場所に出る。
// DB のキャッシュキー (circuitHash) とは別物で、あちらは版を混ぜる
export function circuitKey(lang: CircuitLang, source: string): string {
  return `${lang}\n${source}`
}

export const MERMAID_LANG = 'mermaid'

// 押して解ける問題カードとして描画するフェンス言語
// (docs/58-CBT問題集計画.md)。図ではないが「打ち間違えると黙って
// コードブロックになる」性質は同じなので、下の RENDERED_LANGS に含める
export const QUIZ_LANG = 'quiz'

// 検索ヒットの学習状況を表にして描画するフェンス言語
// (docs/77-進捗マトリックス計画.md)。中身は検索式と設定だけで、
// 数字は表示のたびに作る (フェンスは結果ではなく問いを持つ)
export const MATRIX_LANG = 'matrix'

// 日々の記録 (体重など) を折れ線にして描画するフェンス言語
// (docs/83-健康管理フェンス計画.md)。matrix と同じく中身は検索式と設定だけで、
// 線は表示のたびに引き直す
export const HEALTH_LANG = 'health'

// 打ち間違えると「図やカードになるはずが黙ってコードブロック」になる言語。
// linter はこの綴りの近傍だけを警告する (下記 suggestFenceLang)
export const RENDERED_LANGS = [
  CIRCUITIKZ_LANG,
  CIRCUIT_LANG,
  MERMAID_LANG,
  QUIZ_LANG,
  MATRIX_LANG,
  HEALTH_LANG,
] as const

// 補完に出す言語 (広め)。特別扱いする 6 つ + メモでよく書くコード言語。
// ここに無い言語を書いても普通のコードブロックとして表示されるだけで、
// これは「打ちやすくする」ための候補にすぎない
export const FENCE_LANGUAGES: readonly string[] = [
  CIRCUITIKZ_LANG,
  CIRCUIT_LANG,
  MERMAID_LANG,
  QUIZ_LANG,
  MATRIX_LANG,
  HEALTH_LANG,
  'text',
  'bash',
  'sh',
  'shell',
  'console',
  'diff',
  'json',
  'jsonc',
  'yaml',
  'toml',
  'ini',
  'xml',
  'html',
  'css',
  'scss',
  'js',
  'jsx',
  'ts',
  'tsx',
  'python',
  'c',
  'cpp',
  'csharp',
  'java',
  'kotlin',
  'go',
  'rust',
  'ruby',
  'php',
  'swift',
  'sql',
  'graphql',
  'markdown',
  'dockerfile',
  'makefile',
  'asm',
  'pascal',
  'lua',
  'r',
]

// a を b に変える編集距離 (挿入 / 削除 / 置換 / 隣接転置)。
// max を超えることが確定した時点で打ち切り、max + 1 を返す
// (長い語で無駄に全マスを埋めない)。転置も 1 と数える (Damerau)
export function editDistance(a: string, b: string, max: number): number {
  const n = a.length
  const m = b.length
  if (Math.abs(n - m) > max) {
    return max + 1
  }

  // 3 行 (現在・1 つ前・2 つ前) だけ保持すれば転置まで見られる
  let prev2: number[] = []
  let prev1: number[] = Array.from({ length: m + 1 }, (_, j) => j)
  for (let i = 1; i <= n; i++) {
    const curr = new Array<number>(m + 1)
    curr[0] = i
    let rowMin = curr[0]
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(
        prev1[j] + 1, // 削除
        curr[j - 1] + 1, // 挿入
        prev1[j - 1] + cost, // 置換
      )
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d = Math.min(d, prev2[j - 2] + 1) // 隣接転置
      }
      curr[j] = d
      if (d < rowMin) {
        rowMin = d
      }
    }
    if (rowMin > max) {
      return max + 1
    }
    prev2 = prev1
    prev1 = curr
  }
  return prev1[m]
}

const MAX_FENCE_EDIT_DISTANCE = 2
const MIN_FENCE_TOKEN_LENGTH = 3

// token が RENDERED_LANGS のどれかの打ち間違いっぽければ正しい綴りを返す。
// 完全一致・短すぎ・遠い綴りなら null。大文字小文字だけの違いも打ち間違い扱い
export function suggestFenceLang(token: string): string | null {
  if (token.length < MIN_FENCE_TOKEN_LENGTH) {
    return null
  }
  if ((RENDERED_LANGS as readonly string[]).includes(token)) {
    return null
  }
  const lower = token.toLowerCase()
  for (const lang of RENDERED_LANGS) {
    if (lower === lang) {
      return lang // 大文字小文字だけ違う
    }
    if (editDistance(lower, lang, MAX_FENCE_EDIT_DISTANCE) <= MAX_FENCE_EDIT_DISTANCE) {
      return lang
    }
  }
  return null
}
