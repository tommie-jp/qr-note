// ISBN から書誌を引く順番 (設計は docs/13-書誌自動取得計画.md §1)。
// サーバ側で動く (/api/books/[isbn] から呼ばれる)。
//
// 1 つの API では網羅できないため、性格の違う 2 つを順に試す。
//   openBD    … 新刊・近刊に強い。JSON で軽い。ただし古い本をほぼ持たない
//   NDL サーチ … 納本制度で和書はほぼ網羅。古い本も洋書も引ける。RSS (XML)
//
// 実測 (「プログラミング」を含む本、NDL から採った実在の ISBN の openBD 収録率):
//   1995-1999 年 … 1/12    2003-2007 年 … 2/3
//   2012-2016 年 … 25/25   2022-2025 年 … 18/21
// 新しい本ほど openBD が当たるので先に引き、外したぶんを NDL が拾う。
// 逆順にすると、NDL の目録が追いつく前の新刊を落とす。

import type { BookSummary } from './book'
import { fetchBook as fetchFromNdl } from './ndlSearch'
import { fetchBook as fetchFromOpenBd } from './openbd'
// 1 つの API が黙り込んでも次を試せるよう、取得ごとに上限を持つ
// (withSourceTimeout は productLookup と共通)
import { withSourceTimeout } from './sourceTimeout'

const SOURCES = [
  { name: 'openBD', fetch: fetchFromOpenBd },
  { name: 'NDL サーチ', fetch: fetchFromNdl },
]

// 見つかった最初の書誌を返す。どこにも無ければ null (エラーではない)。
// 個々の API の失敗は握り潰さず警告に残したうえで、次の API を試す。
//
// **どこかが失敗したまま見つからなかったときは throw する**。null と混ぜると
// 「見つかりませんでした」と断定して伝えることになるが、実際には
// 訊けていないだけで、その本が無いことは分かっていない。呼び出し側は
// 「取得に失敗しました」(=もう一度試せば取れるかもしれない) と伝えられる。
export async function lookupBook(
  isbn: string,
  signal?: AbortSignal,
): Promise<BookSummary | null> {
  let failed = false
  for (const source of SOURCES) {
    if (signal?.aborted) {
      break // 呼び出しが打ち切られた。次を叩かない
    }
    try {
      const book = await withSourceTimeout(signal, (s) => source.fetch(isbn, s))
      if (book) {
        return book
      }
      // 収録漏れ。「この API にはっきり無かった」なので警告も出さず次へ
    } catch (err) {
      if (signal?.aborted) {
        throw err // 中断。呼び出し側が黙らせる
      }
      failed = true
      console.warn(`${source.name} から書誌を取得できませんでした`, err)
    }
  }
  if (failed) {
    throw new Error('どの書誌 API からも取得できませんでした')
  }
  return null
}
