// メモ本文中のインラインタグ (#tag) の抽出・正規化ユーティリティ。
// タグの正本はメモ本文であり、items.tags カラムは検索用の派生キャッシュ。
// DB 非依存の純関数として置き、search.ts と同じくテストしやすくする。
//
// タグ記法 (詳細は docs/06-タグ計画.md / docs/05-全文検索の使い方.md):
//   - `#` (半角) または `＃` (全角) の直後に 1 文字以上のタグ文字が続くもの。
//     例: #tag1 / #タグ１ / #トランジスタ / #1608 / #part-a / #a_b
//   - 直前は行頭または空白 (半角/全角)。URL 中の `#fragment` は直前が
//     非空白のためタグにならない。`# 見出し` は # の直後が空白なので対象外。
//   - コードフェンス (```) とインラインコード (`...`) の中は対象外。
//   - 正規化は NFKC + 小文字化。全文検索の NormalizerAuto (全半角・大小同一視)
//     と挙動を揃える (＃ＮＰＮ → npn / #１６０８ → 1608)。

// タグ名に使える文字: Unicode の文字・数字・結合文字と `_` `-`。
const TAG_INNER = String.raw`[\p{L}\p{N}\p{M}_-]`

// 行頭または空白の直後の `#`/`＃` + タグ名。タグ名を 1 グループで捕捉する。
const TAG_PATTERN = String.raw`(?<=^|[\s　])[#＃](${TAG_INNER}+)`

// トークン全体がちょうど 1 つのタグかどうか (検索パーサ用)。
const WHOLE_TAG_PATTERN = String.raw`^[#＃](${TAG_INNER}+)$`

// タグを比較・保存するための正規化キー。
export function normalizeTag(raw: string): string {
  return raw.normalize('NFKC').toLowerCase()
}

// コードフェンスとインラインコードを潰し、コード内の記法 (#tag など) を除外する。
// フェンスは改行へ、インラインコードは inlineReplacement へ置換して前後トークンの
// 境界を保つ (隣接文字が結合しないように)。
// インラインコードの置換文字を差し替えられるのは props.ts のため。タグは「行内に
// タグがあるか」だけを見るので空白でよいが、プロパティは「行全体が key=value か」を
// 見るので、コードの痕跡が空白だと行が条件をすり抜けてしまう (docs/08-プロパティ計画.md)。
export function stripCode(text: string, inlineReplacement = ' '): string {
  return text
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/`[^`\n]*`/g, inlineReplacement)
}

// テキスト中のタグ出現。start は `#`/`＃` の位置、raw は表示用の元の綴り
// (`#抵抗` など)、name は正規化済みのタグ名。
export interface TagMatch {
  start: number
  length: number
  raw: string
  name: string
}

// テキスト中のタグ出現を左から順に返す (コード除去はしない: 呼び出し側の責任)。
// MarkdownView のリンク化は mdast の text ノード (コードを含まない) に適用する。
export function findTags(text: string): TagMatch[] {
  const re = new RegExp(TAG_PATTERN, 'gu')
  const matches: TagMatch[] = []
  for (const m of text.matchAll(re)) {
    matches.push({
      start: m.index,
      length: m[0].length,
      raw: m[0],
      name: normalizeTag(m[1]),
    })
  }
  return matches
}

// メモ本文からタグを抽出する (正規化済み・重複除去・初出順)。
// コードフェンス/インラインコード内は対象外。
export function extractTags(memo: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const { name } of findTags(stripCode(memo))) {
    if (!seen.has(name)) {
      seen.add(name)
      tags.push(name)
    }
  }
  return tags
}

// 単一トークンがタグなら正規化済みタグ名を、そうでなければ null を返す。
// `#` 単独 (タグ名が空) も null (検索側で無視する)。
export function parseTagToken(token: string): string | null {
  const match = new RegExp(WHOLE_TAG_PATTERN, 'u').exec(token)
  return match ? normalizeTag(match[1]) : null
}

// タグ名からタグ検索へのリンク先を作る (`#タグ` を検索窓に入れたのと同じ)。
// 一覧・詳細ページ・メモ内リンクで同じ URL 形式を使うため 1 箇所に集約する。
export function tagSearchHref(tag: string): string {
  return `/?q=${encodeURIComponent(`#${tag}`)}`
}

// tagSearchHref の逆。リンク先がタグ検索なら `#タグ` を、違えば null を返す。
// タグを押したことを検索履歴に残すために使う (docs/59-検索候補計画.md §2)。
//
// **`q` 1 つだけ**の `/?q=#…` に限る。ページ送りや一覧への戻り
// (buildSearchUrl は page / sort を足す) を巻き込まないため — あちらは
// 「今見ている検索を続ける」操作で、新しく検索したわけではない。
export function tagSearchQuery(href: string | null | undefined): string | null {
  if (!href?.startsWith('/?')) {
    return null
  }
  const params = new URLSearchParams(href.slice(2))
  const q = params.get('q')
  if (q === null || [...params.keys()].length !== 1) {
    return null
  }
  return parseTagToken(q) === null ? null : q
}
