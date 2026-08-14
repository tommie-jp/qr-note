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

// セルに出す記号 (計画 §3 の `mark=`)。null なら既定 (✓ / ☐ / —)
export interface MatrixMarkSet {
  unchecked: string
  checked: string
  // 省略できる (既定の — を使う)
  absent: string | null
}

export interface MatrixSpec {
  // 対象を決める検索式 (検索窓と同じ文法)。空なら絞り込みなし
  query: string
  sort: Sort
  // 列に出すチェックの名前 (書かれたままの表示用)。
  // **空なら「状態」1 列** — 名前ではなく 3 状態を出す (計画 §3)
  columns: string[]
  // セルの記号。null なら既定
  marks: MatrixMarkSet | null
}

export type MatrixParseResult = MatrixSpec | { error: string }

// チェックの名前を照合するときの畳み方。表記ゆれのうち「打ち方の違い」だけを
// 吸収する (全角/半角・大文字小文字・前後の空白)。前方一致にはしない —
// `学習済み` が `学習済みだが自信なし` に黙って当たるほうが怖い
export function normalizeCheckLabel(label: string): string {
  return label.normalize('NFKC').trim().toLowerCase()
}

// `mark=` に書ける記号の数。未・済 の 2 つが必須で、3 つ目は「項目なし」
const MIN_MARKS = 2
const MAX_MARKS = 3

// 見た目の 1 文字 (書記素) で割る。
//
// **コードポイントで割ってはいけない。** 絵文字は「1 文字」に見えて複数の
// コードポイントで出来ていることがあり、`✅️` は ✅ (U+2705) + 異体字
// セレクタ (U+FE0F) の 2 つ。素朴に [...s] で割ると 3 つ目に**見えない文字**が
// 現れ、それを「項目なし」の記号に割り当てると透明なセルが並ぶ。
// 家族絵文字 (ZWJ で 8 コードポイント) も書記素なら 1 つと数えられる。
export function splitGraphemes(text: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return [...segmenter.segment(text)].map((part) => part.segment)
  }
  // Intl.Segmenter が無い環境への逃げ道 (コードポイント割り)。異体字
  // セレクタは分かれてしまうが、記号がまったく出ないよりはよい
  return [...text]
}

// 値の中の区切りに使うカンマ。
//
// **区切りは「畳んだ後」で見る。** 照合 (normalizeCheckLabel) が NFKC で
// 畳むのに区切りだけ半角カンマ限定、という組み合わせだと、日本語キーボードの
// 既定である全角カンマが区切りにならない — `col=学習済み，自信あり` は 1 列の
// 長い名前になり、どのチェックにも当たらず全セルが「項目なし」(0.0%) で並ぶ。
// エラーも出ないので、書いた本人には「表が壊れた」としか見えない。
//
// 半角カンマに畳まれる文字はどれも区切りにする (全角 `，`・小字形 `﹐` など)。
// 表を作れる綴りは 1 つだけ、という門番にはしない (`sort=ItemNo` を通すのと
// 同じ作法)。読点 `、` は畳んでも読点なので区切りにしない — 名前の一部
// (`- [ ] 読んだ、解いた`) でありうるほうを立てる
const COMMA = ','

function isComma(char: string): boolean {
  return char.normalize('NFKC') === COMMA
}

// **値そのものは NFKC しない** (絵文字が潰れる)。畳んだ結果で区切りを見分け、
// 名前や記号は打ったまま持つ
function splitOnCommas(value: string): string[] {
  return [...value]
    .map((char) => (isComma(char) ? COMMA : char))
    .join('')
    .split(COMMA)
}

// 打ち間違いへの助言だけに使う表。**受け付ける綴りではない** —
// 受け付けた綴りはノートに残ってやめられないので、増やさずに案内する
const KEY_HINTS: Record<string, string> = {
  display: 'mark',
  marks: 'mark',
  symbol: 'mark',
  symbols: 'mark',
  記号: 'mark',
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

const OPTION_KEYS = ['sort', 'col', 'mark'] as const
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

// 大文字小文字と全角の違いは通す (`sort=ItemNo` / `ｓｏｒｔ＝ｕｐｄａｔｅｄ`)。
// 半角に直させるだけの門番にはしない、という quizParse (全角コロン・全角数字を
// 許す) と同じ作法。**畳むのはこの値だけ** — 行ごと NFKC すると `mark=` の
// 絵文字を潰す (囲み文字の 🈚 が素の 無 になる)
function parseSortValue(value: string): Sort | null {
  const folded = value.normalize('NFKC').toLowerCase()
  return SORTS.find((sort) => sort.toLowerCase() === folded) ?? null
}

// キー=値 の区切り。全角の ＝ も区切りとして認める
function separatorIndex(line: string): number {
  const half = line.indexOf('=')
  const full = line.indexOf('＝')
  if (half < 0) {
    return full
  }
  return full < 0 ? half : Math.min(half, full)
}

function parseColumnsValue(value: string): string[] {
  return splitOnCommas(value)
    .map((label) => label.trim())
    .filter((label) => label !== '')
}

// `mark=` の記号を取り出す。**区切り (空白・カンマ) は記号として数えない。**
//
// くっつけて書く (`mark=☐✓`) のは読みにくいので、間に空白やカンマを入れた
// 書き方が自然に出てくる。ところが素朴に書記素で割ると `mark=☐ ✓` が 3 つに
// 数えられ、済み = 空白 (透明なセル)・項目なし = ✓ (その項目が無いノートが
// 済みに見える) へ割り当てられる。**個数は 3 つなのでエラーにもならない** —
// 未の記号だけが正しく出るぶん、余計に気づけない。
//
// 「区切りを書いたらエラー」にする案は採らない。書き直させるだけで、
// どちらの書き方も同じ表になるほうが説明が短い (絵文字の個数だけを見て
// 文字種を問わない、という mark= の元の作法にも合う)。
function parseMarksValue(value: string): string[] {
  return splitGraphemes(value).filter(
    (mark) => mark.trim() !== '' && !isComma(mark),
  )
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
  let marks: MatrixMarkSet | null = null

  for (const raw of lines.slice(1)) {
    const line = raw.trim()
    if (line === '') {
      continue
    }

    const eq = separatorIndex(line)
    if (eq <= 0) {
      return { error: `設定は「キー=値」の形で書きます: 「${line}」` }
    }
    // **畳むのはキーだけ。** 値は打ったまま持つ — NFKC は一部の絵文字を
    // 潰すので (`🈚` → `無`)、`mark=` に書いた記号が黙って別の文字になる。
    // 照合が要る値は使うところで畳む (sort は parseSortValue、列の名前は
    // normalizeCheckLabel)
    const key = line.slice(0, eq).normalize('NFKC').trim().toLowerCase()
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

    if (key === 'mark') {
      if (marks !== null) {
        return { error: '設定「mark」が 2 回書かれています' }
      }
      const parsed = parseMarksValue(value)
      if (parsed.length < MIN_MARKS || parsed.length > MAX_MARKS) {
        return {
          error: `記号は 未・済 の 2 つ (項目なしを足して 3 つ) で書きます (${parsed.length} つ書かれています)`,
        }
      }
      marks = {
        unchecked: parsed[0],
        checked: parsed[1],
        absent: parsed[2] ?? null,
      }
      continue
    }

    return { error: unknownKeyError(key) }
  }

  return {
    query,
    sort: sort ?? DEFAULT_MATRIX_SORT,
    columns: columns ?? [],
    marks,
  }
}
