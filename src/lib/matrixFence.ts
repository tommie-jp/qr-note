// ```matrix フェンスの設定を読む (DB 非依存の純関数。docs/77-進捗マトリックス計画.md §3)。
//
// **1 行目は必ず検索式**として読み、2 行目以降を `キー=値` として読む。
// 全行を `キー=値` で読む実装だと、`#bjt hFE=195` のようなプロパティ検索の
// 正当な式を書いた 1 行目が設定として食われて壊れる。
//
// 記法の綴りは短く英語で統一している (`col` / `sort`)。理由は計画の §3 に
// あるが要点は 2 つ — 並び順は種別と方向を 1 語に畳んでおり
// (docs/64、`itemNoDesc` など)、日本語の呼び名では逆順が 1 語で書けない。
// そして 1 行目の検索式が既に `is:todo` / `OR` / `!` と英語である。

import { editDistance } from './fenceLanguages'
import { SORTS, type Sort } from './validation'

// 1 つの表に並べる列の上限。横に伸びた表はスマホで読めないうえ、
// 列が増えるほど 1 行の情報量ではなく横スクロールの量が増える
export const MAX_MATRIX_COLUMNS = 4

// 並び順の既定。docs/60-学習進捗計画.md §4 のとおり、順に回す用途では
// 番号順を使う (更新順はチェックを押した瞬間に並びが動いて前後が狂う)
const DEFAULT_MATRIX_SORT: Sort = 'itemNo'

export interface MatrixSpec {
  // 対象を決める検索式 (検索窓と同じ文法)。空なら絞り込みなし
  query: string
  sort: Sort
  // 列に出すチェックの名前 (書かれたままの表示用)。
  // **空なら「状態」1 列** — 名前ではなく 3 状態を出す (計画 §3)
  columns: string[]
}

export type MatrixParseResult = MatrixSpec | { error: string }

// チェックの名前を照合するときの畳み方。表記ゆれのうち「打ち方の違い」だけを
// 吸収する (全角/半角・大文字小文字・前後の空白)。前方一致にはしない —
// `学習済み` が `学習済みだが自信なし` に黙って当たるほうが怖い
export function normalizeCheckLabel(label: string): string {
  return label.normalize('NFKC').trim().toLowerCase()
}

// 打ち間違いへの助言だけに使う表。**受け付ける綴りではない** —
// 受け付けた綴りはノートに残ってやめられないので、増やさずに案内する
const KEY_HINTS: Record<string, string> = {
  cols: 'col',
  column: 'col',
  columns: 'col',
  check: 'col',
  checks: 'col',
  列: 'col',
  order: 'sort',
  並び: 'sort',
  並び順: 'sort',
}

const OPTION_KEYS = ['sort', 'col'] as const
const MAX_KEY_EDIT_DISTANCE = 2

function suggestKey(key: string): string | null {
  const hinted = KEY_HINTS[key]
  if (hinted !== undefined) {
    return hinted
  }
  for (const known of OPTION_KEYS) {
    if (editDistance(key, known, MAX_KEY_EDIT_DISTANCE) <= MAX_KEY_EDIT_DISTANCE) {
      return known
    }
  }
  return null
}

function unknownKeyError(key: string): string {
  const suggestion = suggestKey(key)
  return suggestion === null
    ? `知らない設定「${key}」です`
    : `知らない設定「${key}」です。${suggestion}= のことですか?`
}

// 大文字小文字だけの違いは通す (`sort=ItemNo`)。半角に直させるだけの
// 門番にはしない、という quizParse (全角コロン・全角数字を許す) と同じ作法
function parseSortValue(value: string): Sort | null {
  const lower = value.toLowerCase()
  return SORTS.find((sort) => sort.toLowerCase() === lower) ?? null
}

function parseColumnsValue(value: string): string[] {
  return value
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label !== '')
}

// 照合すると同じになる列があれば、その 2 つ目を返す (無ければ null)
function firstDuplicateLabel(labels: readonly string[]): string | null {
  const seen = new Set<string>()
  for (const label of labels) {
    const key = normalizeCheckLabel(label)
    if (seen.has(key)) {
      return label
    }
    seen.add(key)
  }
  return null
}

export function parseMatrixFence(source: string): MatrixParseResult {
  const lines = source.split(/\r?\n/)
  // 1 行目だけは正規化しない — 検索式の正規化 (NFKC) は tokenize が
  // 自分で行う作法なので、ここで先回りすると引用リテラルの中身まで畳む
  const query = (lines[0] ?? '').trim()

  let sort: Sort | null = null
  let columns: string[] | null = null

  for (const raw of lines.slice(1)) {
    // 設定行は全角も畳む (`ｓｏｒｔ＝ｕｐｄａｔｅｄ`)。値のうちチェックの
    // 名前は表示に使うが、NFKC は日本語の文字を変えないので害はない
    const line = raw.normalize('NFKC').trim()
    if (line === '') {
      continue
    }

    const eq = line.indexOf('=')
    if (eq <= 0) {
      return { error: `設定は「キー=値」の形で書きます: 「${line}」` }
    }
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim()

    if (key === 'sort') {
      if (sort !== null) {
        return { error: '設定「sort」が 2 回書かれています' }
      }
      const parsed = parseSortValue(value)
      if (parsed === null) {
        return {
          error: `並び順「${value}」は使えません (${SORTS.join(' / ')})`,
        }
      }
      sort = parsed
      continue
    }

    if (key === 'col') {
      if (columns !== null) {
        return { error: '設定「col」が 2 回書かれています' }
      }
      const parsed = parseColumnsValue(value)
      if (parsed.length === 0) {
        return { error: '列の名前が空です (col=学習済み のように書きます)' }
      }
      if (parsed.length > MAX_MATRIX_COLUMNS) {
        return {
          error: `列は ${MAX_MATRIX_COLUMNS} つまでです (${parsed.length} つ書かれています)`,
        }
      }
      // 同じ名前の列を 2 つ作らせない。照合先が同じなので必ず同じ値が並び、
      // 表の幅が増えるだけで読み手には区別が付かない (`TODO` と `todo` の
      // ように綴りが違っても照合すれば同じ)
      const duplicate = firstDuplicateLabel(parsed)
      if (duplicate !== null) {
        return { error: `列「${duplicate}」が 2 回書かれています` }
      }
      columns = parsed
      continue
    }

    return { error: unknownKeyError(key) }
  }

  return {
    query,
    sort: sort ?? DEFAULT_MATRIX_SORT,
    columns: columns ?? [],
  }
}
