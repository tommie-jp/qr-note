// メモ本文中のプロパティ行 (hFE=208 Vf=700mV) の抽出・集計ユーティリティ。
// プロパティの正本はメモ本文であり、items.props カラムは表示用の派生キャッシュ。
// tags.ts と同じく DB 非依存の純関数として置く。
//
// プロパティ記法 (詳細は docs/08-プロパティ計画.md / docs/メモ記法.md):
//   - 「行全体が空白区切りの key=value トークンだけで構成される行」をプロパティ行と
//     みなす。位置は自由で、複数行あればマージする (同じキーは先勝ち)。
//     散文が混ざった行 (`実測では hFE=195 だった`) は行ごと対象外。これにより
//     本文中の key=value と誤解なく共存できる。
//   - key=value は空白を挟まない (`hFE = 208` は不可)。
//   - キーは英字始まりの英数字・`_`・`-`。正規化は tags.ts と同じ NFKC + 小文字化
//     (hFE と HFE は同じ列)。表示は書いた綴りのまま (label)。
//   - 値は空白と `=` を含まない 1 文字以上。表には書いたまま出し、ソートのときだけ
//     数値部を見る (208 / 700mV / 0.7V / -40 / 120～200 / TO-92 / 2SC1815)。
//   - コードフェンス・インラインコード・数式の中は対象外。URL 中の `?a=1` は
//     キーが英字始まりでないため自然に外れる。
//
// 値を「数値 + 単位」に狭めない理由: 誤爆を防いでいるのは「行全体が key=value」と
// 「キーは英字始まり」の 2 つで、値の狭さは安全性に寄与しない。一方で狭めると
// device=BC547 や pkg=TO-92 のような値でその行のプロパティが丸ごと落ちる
// (エラーにならず黙って消える)。実メモに device=2N5551 / hFE=120～200 のような
// 書き方が既にあるため、値は緩く受けて表示はそのまま、判断は人に委ねる。

import { INLINE_MATH } from '@/lib/memoSummary'
import { normalizeTag, stripCode } from '@/lib/tags'

// メモ本文から抽出した 1 プロパティ。
// key は比較・列マージ用の正規化キー、label は表ヘッダ用の元の綴り、
// value は書いたままの値 (単位つき)。
// interface ではなく type にしているのは、そのまま Prisma の Json 列
// (InputJsonValue) へ渡せるようにするため (interface には暗黙の
// インデックスシグネチャが付かず、Json 型と適合しない)。
export type PropEntry = {
  key: string
  label: string
  value: string
}

// キー: 英字始まりの英数字・`_`・`-` (NFKC + 小文字化した後の形)。
const KEY_PATTERN = /^[a-z][a-z0-9_-]*$/

// コード・数式の痕跡を表す非トークン文字 (U+FFFC OBJECT REPLACEMENT CHARACTER)。
// 空白ではなくこの文字へ潰すことで、コードや数式を含む行が「行全体が key=value」の
// 条件をすり抜けないようにする。
const PLACEHOLDER = '￼'

// 値: 空白・区切り (`=` / `＝`)・コードの痕跡を含まない 1 文字以上
// (単位・範囲・型番など何でも入る)。
// 値の中に区切りが残る行 (`Ｖｉ=２Ｖ、Ｒ＝５ｋΩ` のような読点区切りの羅列) は
// プロパティ行ではなく本文とみなす。空白区切りで書き直せばプロパティになる。
// PLACEHOLDER を弾くのは、値をコードや数式で書いた行 (`hFE=`208``) で痕跡が
// そのまま値になり、表に ￼ が並ぶのを防ぐため。
const VALUE_PATTERN = new RegExp(`^[^\\s=＝${PLACEHOLDER}]+$`, 'u')

// 値の末尾の読点・コンマ。`hFE=440, Vf=696mV` のような区切りの名残であって
// 値の一部ではないので落とす (tags.ts が `#抵抗。` を「抵抗」で切るのと同じ考え)。
const VALUE_TRAILING_PUNCT = /[,、]+$/u

// key と value の区切り (全角 ＝ は NFKC で = に畳まれるが、元トークンの分割にも使う)。
const SEPARATOR = /[=＝]/

// 半角空白 (\s) と全角空白 (　) の連続。search.ts の TERM_SEPARATOR と揃える。
const TOKEN_SEPARATOR = /[\s　]+/

// 比較・保存のための正規化キー。正規化の規則 (NFKC + 小文字化) はタグと同じで、
// 全文検索の NormalizerAuto に揃えるためのものなので tags.ts の 1 箇所に持たせる。
function normalizeKey(raw: string): string {
  return normalizeTag(raw)
}

// 単一トークンがプロパティなら PropEntry を、そうでなければ null を返す。
// 判定は NFKC 正規化後に行い、label / value には元の綴りを残す。
export function parsePropToken(token: string): PropEntry | null {
  const sep = token.search(SEPARATOR)
  if (sep < 0) {
    return null
  }
  const label = token.slice(0, sep)
  const value = token.slice(sep + 1).replace(VALUE_TRAILING_PUNCT, '')
  if (label.length === 0 || value.length === 0) {
    return null
  }
  const key = normalizeKey(label)
  if (!KEY_PATTERN.test(key) || !VALUE_PATTERN.test(value)) {
    return null
  }
  return { key, label, value }
}

// コードフェンス・インラインコード・数式を潰す。
// フェンスとブロック数式は行ごと消えるように改行へ、インラインのものは
// 行全体条件を満たさなくするために PLACEHOLDER へ置換する。
// インライン数式の見つけ方は memoSummary の INLINE_MATH に揃える —
// 別の正規表現を持つと、プレビュー (memoPreview → isPropLine) と
// ここでプロパティ行の判定が食い違う
function stripNonProse(memo: string): string {
  return stripCode(memo, PLACEHOLDER)
    .replace(/\$\$[\s\S]*?\$\$/g, '\n')
    .replace(INLINE_MATH, PLACEHOLDER)
}

// 行がプロパティ行 (全トークンが key=value) なら各トークンの PropEntry を返す。
// 1 つでも key=value でないトークンがあれば null (= ただの本文)。
function parsePropLine(line: string): PropEntry[] | null {
  const tokens = line.split(TOKEN_SEPARATOR).filter((token) => token.length > 0)
  if (tokens.length === 0) {
    return null
  }
  const entries: PropEntry[] = []
  for (const token of tokens) {
    const entry = parsePropToken(token)
    if (entry === null) {
      return null
    }
    entries.push(entry)
  }
  return entries
}

// 1 行がプロパティ行 (全トークンが key=value) か。
// 一覧の本文プレビュー (memoPreview) が「特性表に出る行」を落とすのに使う。
// 線引きを 2 か所に書き分けないよう、判定はこの 1 つに寄せる。
export function isPropLine(line: string): boolean {
  return parsePropLine(stripNonProse(line)) !== null
}

// メモ本文からプロパティを抽出する (初出順・キー重複は先勝ち)。
export function extractProps(memo: string): PropEntry[] {
  const seen = new Set<string>()
  const props: PropEntry[] = []
  for (const line of stripNonProse(memo).split(/\r?\n/)) {
    const entries = parsePropLine(line)
    if (entries === null) {
      continue
    }
    for (const entry of entries) {
      if (seen.has(entry.key)) {
        continue
      }
      seen.add(entry.key)
      props.push(entry)
    }
  }
  return props
}

// 値の数値部 (ソート用)。数値部がなければ NaN。
export function parsePropNumber(value: string): number {
  return Number.parseFloat(value.normalize('NFKC'))
}

// jsonb から読んだ値を PropEntry[] へ変換する (境界での防御的パース)。
// 不正な形のものは黙って捨てる: props は memo から再計算できる派生キャッシュで、
// 表示のために全体を落とすより読める分だけ出すほうが実害が小さい。
export function parseStoredProps(value: unknown): PropEntry[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(isPropEntry)
}

function isPropEntry(value: unknown): value is PropEntry {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as Record<string, unknown>
  return (
    typeof entry.key === 'string' &&
    typeof entry.label === 'string' &&
    typeof entry.value === 'string'
  )
}

// 表の元データ 1 件 (items.ts が DB から組み立てる)。
export interface ItemPropsRow {
  itemNo: string
  summary: string
  props: PropEntry[]
}

export interface PropsTableColumn {
  key: string
  label: string
}

export interface PropsTableRow {
  itemNo: string
  summary: string
  // 列キー → 表示値。列を持たないノートはキーごと欠ける。
  cells: Record<string, string>
}

export interface PropsTableData {
  columns: PropsTableColumn[]
  rows: PropsTableRow[]
}

export type PropsSortDir = 'asc' | 'desc'

// 検索結果のプロパティを表の形へ集計する。
// 列は結果集合に現れるキーの和集合 (初出順・綴りは初出のもの)、
// 行はプロパティを持つノートだけ (プロパティ無しは表に出さない)。
export function buildPropsTable(rows: ItemPropsRow[]): PropsTableData {
  const columns: PropsTableColumn[] = []
  const seen = new Set<string>()
  const tableRows: PropsTableRow[] = []

  for (const row of rows) {
    if (row.props.length === 0) {
      continue
    }
    const cells: Record<string, string> = {}
    for (const { key, label, value } of row.props) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push({ key, label })
      }
      cells[key] = value
    }
    tableRows.push({ itemNo: row.itemNo, summary: row.summary, cells })
  }

  return { columns, rows: tableRows }
}

// 表を 1 列で並べ替える (元の配列は変更しない)。
// まず値の数値部で比べ、数値部が無い/同じなら文字列で比べる。この 2 段構えで
// hFE=400 と hFE=208 は数値順に、device=2SC1815 と device=2N2222 (どちらも
// 数値部は 2) や pkg=TO-92 は名前順に、それぞれ期待どおり並ぶ。
// 単位換算はしないため、mV と V が混在すると数値順になる (docs/08-プロパティ計画.md)。
// その列の値を持たない行は、昇順・降順どちらでも末尾に置く。
export function sortTableRows(
  rows: PropsTableRow[],
  sortKey: string | null,
  dir: PropsSortDir,
): PropsTableRow[] {
  if (sortKey === null) {
    return rows
  }
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const left = a.cells[sortKey]
    const right = b.cells[sortKey]
    if (left === undefined || right === undefined) {
      // 欠損は常に末尾 (両方欠損なら元の順序を保つ)。
      if (left === undefined && right === undefined) return 0
      return left === undefined ? 1 : -1
    }
    return compareValues(left, right) * sign
  })
}

// 値 2 つの比較: 数値部が両方あって異なればその差、それ以外は文字列比較。
function compareValues(left: string, right: string): number {
  const leftNum = parsePropNumber(left)
  const rightNum = parsePropNumber(right)
  if (!Number.isNaN(leftNum) && !Number.isNaN(rightNum) && leftNum !== rightNum) {
    return leftNum - rightNum
  }
  return left.localeCompare(right)
}
