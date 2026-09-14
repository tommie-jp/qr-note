// openBD (https://openbd.jp/) の書誌 API との境界
// (設計は docs/13-書誌自動取得計画.md)。
//
// ISBN をスキャンしたとき、この API を**スマホのブラウザから直接**引く。
// openBD は access-control-allow-origin: * を返すので CORS で弾かれず、
// API キーも要らない。サーバを経由しないので、VPS のコードも設定も増えない。
//
// 新刊・近刊に強い一方、**古い本はほとんど持っていない** (実測: 1990 年代の
// 本の収録率 1/12、2012-2016 年は 25/25)。落ちた分は NDL サーチが拾う
// (external/bookLookup.ts)。

import { asRecord, asString, type BookSummary, formatPubdate } from './book'

const OPENBD_ENDPOINT = 'https://api.openbd.jp/v1/get'

export function openBdUrl(isbn: string): string {
  return `${OPENBD_ENDPOINT}?isbn=${encodeURIComponent(isbn)}`
}

// 著者は ONIX の Contributor から取る。summary.author は
// "Boswell,Dustin Foucher,Trevor 角,征典" と著者名を空白で連結した文字列で、
// 名前自体に空白が入りうる以上、区切り位置を復元できない。
// ONIX は 1 人 1 要素の配列なので確実に分けられる。
// 並び順は openBD の返す順のまま使う (SequenceNumber 順に整列済み)。
function authorsFromOnix(onix: unknown): string[] {
  const contributors = asRecord(asRecord(onix).DescriptiveDetail).Contributor
  if (!Array.isArray(contributors)) {
    return []
  }
  return contributors
    .map((c) => asString(asRecord(asRecord(c).PersonName).content))
    .filter(Boolean)
}

// 応答 (JSON.parse 済み) から書誌を取り出す。
// openBD は [書誌] か [null] (収録なし) を返す。
//
// 書名が無いものは null にする。書名は本文の 1 行目 = 一覧の要約になるもので、
// これが無いなら事前入力を書き換える意味がない。
export function parseOpenBdResponse(json: unknown): BookSummary | null {
  if (!Array.isArray(json)) {
    return null
  }
  const entry = asRecord(json[0])
  const summary = asRecord(entry.summary)
  const title = asString(summary.title)
  if (!title) {
    return null
  }
  const onixAuthors = authorsFromOnix(entry.onix)
  const summaryAuthor = asString(summary.author)
  return {
    title,
    authors:
      onixAuthors.length > 0 ? onixAuthors : summaryAuthor ? [summaryAuthor] : [],
    publisher: asString(summary.publisher),
    pubdate: formatPubdate(asString(summary.pubdate)),
    // 書影の URL。JPRO の規約改定以降、ここが入るのはホワイトリスト版元だけで、
    // 空のほうが多数派 (実測 1/11)。落ちたぶんは楽天が拾う (external/coverLookup.ts)
    coverUrl: asString(summary.cover) || undefined,
  }
}

// ISBN の書誌を引く。収録漏れのときは null (エラーではない)。
// タイムアウトは呼び出し側が signal で持つ (external/bookLookup.ts)。
export async function fetchBook(
  isbn: string,
  signal?: AbortSignal,
): Promise<BookSummary | null> {
  const res = await fetch(openBdUrl(isbn), { signal })
  if (!res.ok) {
    throw new Error(`openBD が HTTP ${res.status} を返しました`)
  }
  return parseOpenBdResponse(await res.json())
}
