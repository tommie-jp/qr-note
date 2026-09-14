// JAN から商品情報を引く (設計は docs/14-JAN商品情報取得計画.md §1)。
// サーバ側で動く (/api/products/[jan] から呼ばれる)。
//
// いまは Yahoo!ショッピング 1 本。楽天のフォールバックは JAN 専用の口が無く
// (keyword 検索)、Yahoo! の取りこぼしが実際に苦になってから足す。
// 1 本でも bookLookup と同じく取得に上限を持ち (withSourceTimeout)、
// API が黙り込んでも導線を吊るさない。
//
// 収録漏れ・キー未設定は null (エラーではない)。取得の失敗はそのまま throw する。
// null と混ぜると「見つかりませんでした」と断定して伝えることになるが、
// 実際には訊けていないだけ (bookLookup と同じ判断)。ソースが 1 本なので
// ここで catch して包み直すものはない。

import type { ProductSummary } from './product'
import { withSourceTimeout } from './sourceTimeout'
import { fetchProduct } from './yahooShopping'

export async function lookupProduct(
  jan: string,
  signal?: AbortSignal,
): Promise<ProductSummary | null> {
  return withSourceTimeout(signal, (s) => fetchProduct(jan, s))
}
