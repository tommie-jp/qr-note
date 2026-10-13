// 計器の画面フェンス (vna・scope・spectrum・graph) の `data:` を、同じメモに貼った
// 添付から引く (docs/103 §3)。
//
// 上流の処理系は `data: (name) => string | null` を受ける**同期の関数**で、ファイルを
// 読むのは呼ぶ側の仕事。QR Note の添付は保存名が `UUID.拡張子` で元の名前を持たないが、
// 本文には画像の記法 `![3-1.csv](/api/images/UUID.csv)` が残り、**alt が元の名前**になる。
// その alt を名前として引く。メモの外のファイルは引かない。
//
// 純関数だけを置く (DOM も fetch も知らない)。取りに行く側は BoardDiagram。
import { TEXT_EXTENSION_ALTERNATION } from '../text/textFormats'

// 1 図が取りに行く添付の数と、1 つの大きさ。他人の書いたノートを描く前提 (circuit-fence の
// 方針と同じ)。上流の処理系も 1 MB までしか読まない
export const MAX_DATA_FILES = 8
export const MAX_DATA_BYTES = 1024 * 1024

// 本文の `data: 名前 [凡例]` の名前。**行頭の `data:` だけ** — 上流の文法は最上位のキー。
// `/` や `..` を含む名前は上流も断るので、ここでも拾わない (下の pathLike)
const DATA_LINE = /^data:[ \t]*([^\s#]+)/gm

/** フェンスの本文が `data:` で指している名前 (書かれた順・重複なし)。 */
export function dataNamesOf(source: string): string[] {
  const names: string[] = []
  for (const match of source.matchAll(DATA_LINE)) {
    const name = match[1]
    // 語の途中で切らず、丸ごと見て断る (`dir/x.csv` の `dir` だけを拾わない)
    const pathLike = name === undefined || /[/\\]/.test(name) || name.startsWith('.')
    if (name !== undefined && !pathLike && !names.includes(name)) {
      names.push(name)
    }
  }
  return names.slice(0, MAX_DATA_FILES)
}

// `![alt](url)`。url は本文に貼られる配信 URL (`/api/images/<uuid>.csv`)。
// 拡張子はテキスト形式の一覧から作る (足し忘れを作らない)
const TEXT_IMAGE = new RegExp(
  `!\\[([^\\]\\n]*)\\]\\((/api/images/[0-9A-Za-z-]+\\.(?:${TEXT_EXTENSION_ALTERNATION}))\\)`,
  'gi',
)

/**
 * メモの本文に貼られたテキスト添付の「元の名前 (alt) → 配信 URL」。
 * 同じ名前が複数あれば**先に書いたもの**を採る (読み手が上から読むのと同じ)。
 */
export function attachmentIndexOf(markdown: string): ReadonlyMap<string, string> {
  const index = new Map<string, string>()
  for (const match of markdown.matchAll(TEXT_IMAGE)) {
    const alt = match[1]?.trim()
    const url = match[2]
    if (alt && url && !index.has(alt)) {
      index.set(alt, url)
    }
  }
  return index
}

/** `data:` の名前のうち、メモに添付が見つからないもの (お知らせに出す)。 */
export function missingNames(
  names: readonly string[],
  index: ReadonlyMap<string, string>,
): string[] {
  return names.filter((name) => !index.has(name))
}

export interface LoadedData {
  /** 取れた添付の「名前 → 本文」。処理系の `data` 関数の元になる。 */
  readonly files: ReadonlyMap<string, string>
  /** 取れなかったものの理由 (お知らせに出す。図は理想だけで出る)。 */
  readonly problems: readonly string[]
}

/**
 * `data:` が指す名前の添付を取りに行く。**取得は注入された関数で行う** (ブラウザでは
 * fetch、試験では差し替え)。1 つ失敗しても残りは取る — 図は消さず、理想の線だけでも出す。
 */
export async function loadDataFiles(
  names: readonly string[],
  index: ReadonlyMap<string, string>,
  fetchText: (url: string) => Promise<string>,
): Promise<LoadedData> {
  const files = new Map<string, string>()
  const problems: string[] = []
  for (const name of names) {
    const url = index.get(name)
    if (url === undefined) {
      problems.push(
        `data: の「${name}」がこのメモに見つかりません。\`![${name}](…)\` の形で添付すると読めます`,
      )
      continue
    }
    try {
      const text = await fetchText(url)
      if (text.length > MAX_DATA_BYTES) {
        problems.push(`data: の「${name}」が大きすぎます (1 MB まで)`)
        continue
      }
      files.set(name, text)
    } catch {
      problems.push(`data: の「${name}」を取得できませんでした`)
    }
  }
  return { files, problems }
}
