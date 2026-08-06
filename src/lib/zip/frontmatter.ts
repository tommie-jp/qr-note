// Markdown の先頭に置く frontmatter の読み書き (docs/28-エクスポート計画.md §1)。
//
// **YAML ライブラリは入れない**。ここで扱うのは「1 階層・スカラーだけ・鍵は 6 つ」
// という決め打ちの形 (noteFile.ts) で、YAML の全機能 (別名参照・型タグ・複数行)
// は要らないうえ、読み込みは書き込み境界なので解釈の広さがそのまま穴になる。
// 逆に**書く側の逃がし方だけは厳密**でなければならない — url は利用者が自由に
// 書ける文字列だからである。
//
// 引用符付きの値は JSON の書き方で逃がす。YAML 1.2 は JSON の上位互換なので、
// JSON.stringify の出力はそのまま「YAML の二重引用スカラー」として妥当で、
// Obsidian など外のツールでも同じ値に読める。

export type FrontmatterValue =
  // 利用者由来の文字列。JSON と同じ書き方で逃がす
  | { quoted: string }
  // 書式が決まっている値 (enum・真偽・ISO 日時)。素で置いて人が読みやすくする
  | { bare: string }

const FENCE = '---'

export function serializeFrontmatter(
  fields: readonly (readonly [string, FrontmatterValue])[],
): string {
  const lines = fields.map(([key, value]) => {
    const text = 'quoted' in value ? JSON.stringify(value.quoted) : value.bare
    return `${key}: ${text}`
  })
  return [FENCE, ...lines, FENCE, ''].join('\n')
}

export interface ParsedFrontmatter {
  fields: Map<string, string>
  // frontmatter を取り除いた残り。**素通しする** — 本文は memo そのもので、
  // 改行の詰め方まで含めて書き出したままを戻したい
  body: string
}

// frontmatter を読む。読めなければ null (呼ぶ側がそのファイルを見送る)。
//
// 「値が空」と「行が壊れている」を区別するのが要点。壊れた行を黙って読み飛ばすと、
// url が欠けたノートが「取り込めた」ことになってしまう。
export function parseFrontmatter(text: string): ParsedFrontmatter | null {
  const opening = new RegExp(`^${FENCE}[ \\t]*\\r?\\n`).exec(text)
  if (opening === null) {
    return null
  }

  const fields = new Map<string, string>()
  let pos = opening[0].length
  for (;;) {
    const newline = text.indexOf('\n', pos)
    const lineEnd = newline === -1 ? text.length : newline
    const line = trimCarriageReturn(text.slice(pos, lineEnd))
    pos = newline === -1 ? text.length : newline + 1

    if (line.trim() === FENCE) {
      return { fields, body: text.slice(pos) }
    }
    if (newline === -1) {
      // 閉じの --- が来ないまま終わった。frontmatter ではなく、たまたま
      // --- で始まる本文だったということ
      return null
    }

    const trimmed = line.trim()
    // 空行と YAML のコメント。人が手で書き足すことがある
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    }

    const parsed = parseField(trimmed)
    if (parsed === null) {
      return null
    }
    fields.set(parsed.key, parsed.value)
  }
}

function parseField(line: string): { key: string; value: string } | null {
  const colon = line.indexOf(':')
  if (colon <= 0) {
    return null
  }
  const key = line.slice(0, colon).trim()
  const raw = line.slice(colon + 1).trim()
  if (key === '') {
    return null
  }
  if (!raw.startsWith('"')) {
    return { key, value: raw }
  }
  try {
    const value: unknown = JSON.parse(raw)
    // "1042" のような文字列だけを受ける。配列やオブジェクトが来る形は
    // そもそも書き出していないので、読む側も知らないままでよい
    return typeof value === 'string' ? { key, value } : null
  } catch {
    // 引用符の開きだけがある・壊れた逃がし方。素通しすると引用符ごと値に
    // 入って往復が壊れるので、ファイルごと見送る
    return null
  }
}

function trimCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}
