// フェンス言語まわりの単一ソース。
// エディタ (client) からも読むため、remark/mdast などの重い依存は持たない
// 葉モジュールにしている (circuitFences はここから CIRCUIT_LANG を re-export する)。

// 特別に図として描画するフェンス言語
export const CIRCUIT_LANG = 'circuitikz'
export const MERMAID_LANG = 'mermaid'

// 押して解ける問題カードとして描画するフェンス言語
// (docs/58-CBT問題集計画.md)。図ではないが「打ち間違えると黙って
// コードブロックになる」性質は同じなので、下の RENDERED_LANGS に含める
export const QUIZ_LANG = 'quiz'

// 打ち間違えると「図やカードになるはずが黙ってコードブロック」になる言語。
// linter はこの綴りの近傍だけを警告する (下記 suggestFenceLang)
export const RENDERED_LANGS = [CIRCUIT_LANG, MERMAID_LANG, QUIZ_LANG] as const

// 補完に出す言語 (広め)。特別扱いする 3 つ + メモでよく書くコード言語。
// ここに無い言語を書いても普通のコードブロックとして表示されるだけで、
// これは「打ちやすくする」ための候補にすぎない
export const FENCE_LANGUAGES: readonly string[] = [
  CIRCUIT_LANG,
  MERMAID_LANG,
  QUIZ_LANG,
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
