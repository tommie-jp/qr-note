// NDL サーチ (国立国会図書館) の OpenSearch API との境界
// (設計は docs/13-書誌自動取得計画.md)。
//
// openBD が持っていない本を拾う担当。納本制度により和書はほぼ網羅されていて、
// 実測では 1990 年代の本の収録率が openBD の 1/12 に対しこちらは 12/12。
// NDL 所蔵の洋書も引ける。
//
// **サーバから呼ぶ**。この口は CORS ヘッダを返さないのでブラウザからは
// 引けない。CORS を返す SRU の口もあるが、未キャッシュの ISBN で 14〜42 秒
// かかり実用にならなかった (実測)。こちらは未キャッシュでも 30ms〜3 秒。
//
// 13 桁で引ける。古い本は ISBN-10 で記録されているが NDL 側が正規化して
// 照合してくれる (実測: 記録が 4756116299 の本に 9784756116291 で当たる)。
// スキャンで得られるのは常に 13 桁なので、これが無いと目的の「古い本」が引けない。

import { XMLParser } from 'fast-xml-parser'
import { asString, type BookSummary, formatPubdate } from './book'

const NDL_OPENSEARCH_ENDPOINT = 'https://ndlsearch.ndl.go.jp/api/opensearch'

export function ndlSearchUrl(isbn: string): string {
  const params = new URLSearchParams({ isbn, cnt: '1' })
  return `${NDL_OPENSEARCH_ENDPOINT}?${params.toString()}`
}

const parser = new XMLParser({
  // 既定では値を数値に変換してしまい、刊行年月 "1996.10" が 1996.1 になる
  // (10 月が 1 月に化ける)。書誌はすべて文字列として読む
  parseTagValue: false,
  ignoreAttributes: true,
  // 1 件でも配列で受け取り、件数による分岐を無くす
  isArray: (name) => ['item', 'dc:creator', 'dc:publisher'].includes(name),
})

// NDL は典拠の生没年を付ける ("尾田, 栄一郎, 1975-" / "夏目, 漱石, 1867-1916")。
// openBD の ONIX は "角, 征典" なので、2 つの API で本文の見た目を揃える。
// 生没年の形をしたものだけ落とす ("大野, 浩, テクニカルライター" は残す)。
function stripLifespan(name: string): string {
  return name.replace(/,\s*\d{4}-(\d{4})?$/, '')
}

// OpenSearch (RSS) の応答から書誌を取り出す。
//
// 書名が無いものは null。書名は本文の 1 行目 = 一覧の要約になるもので、
// これが無いなら事前入力を書き換える意味がない。
export function parseNdlSearchResponse(xml: string): BookSummary | null {
  let doc: unknown
  try {
    doc = parser.parse(xml)
  } catch {
    return null // XML として壊れている
  }
  // 同じ ISBN に別の書名の記録が 2 つあることがある (実測)。最初の 1 件を使う
  const item = (doc as { rss?: { channel?: { item?: unknown[] } } })?.rss?.channel
    ?.item?.[0] as Record<string, unknown> | undefined
  if (!item) {
    return null
  }
  const title = asString(item['dc:title'])
  if (!title) {
    return null
  }
  const creators = Array.isArray(item['dc:creator']) ? item['dc:creator'] : []
  const publishers = Array.isArray(item['dc:publisher']) ? item['dc:publisher'] : []
  return {
    title,
    authors: creators.map(asString).filter(Boolean).map(stripLifespan),
    // 2 つめ以降は発売元なので最初だけ使う
    publisher: asString(publishers[0]),
    // dc:date は年だけ ("1996")、dcterms:issued は "1996.2"。細かいほうを採る
    pubdate: formatPubdate(asString(item['dcterms:issued']) || asString(item['dc:date'])),
  }
}

// ISBN の書誌を引く。見つからなければ null (エラーではない)。
export async function fetchBook(
  isbn: string,
  signal?: AbortSignal,
): Promise<BookSummary | null> {
  const res = await fetch(ndlSearchUrl(isbn), { signal })
  if (!res.ok) {
    throw new Error(`NDL サーチが HTTP ${res.status} を返しました`)
  }
  return parseNdlSearchResponse(await res.text())
}
