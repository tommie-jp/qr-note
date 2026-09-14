// Yahoo!ショッピング商品検索 API v3 との境界
// (設計は docs/14-JAN商品情報取得計画.md §1)。
//
// JAN をスキャンしたとき、商品名・ブランドをエディタに事前入力するために引く。
// openBD/NDL と違って Client ID が要り、ブラウザから直接引くと全員に見える。
// キーの秘匿のためサーバでだけ動く (/api/products/[jan] から呼ばれる)。

import { yahooShoppingAppIdEnv } from '../appEnv'
import { asRecord, asString } from './book'
import type { ProductSummary } from './product'

const ENDPOINT = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch'

export function yahooShoppingUrl(jan: string, appid: string): string {
  // 使うのは 1 件目だけなので 1 件だけ受け取る (既定の並びは関連度順)
  const params = new URLSearchParams({ appid, jan_code: jan, results: '1' })
  return `${ENDPOINT}?${params}`
}

// 応答 (JSON.parse 済み) から商品情報を取り出す。
// 形は { totalResultsAvailable, hits: [{ name, brand: { name }, ... }] }。
//
// 商品名が無いものは null にする。商品名は本文の 1 行目 = 一覧の要約になるもので、
// これが無いなら事前入力を書き換える意味がない (書誌の書名と同じ扱い)。
export function parseYahooShoppingResponse(json: unknown): ProductSummary | null {
  const hits = asRecord(json).hits
  if (!Array.isArray(hits)) {
    return null
  }
  const hit = asRecord(hits[0])
  const title = asString(hit.name)
  if (!title) {
    return null
  }
  return { title, brand: asString(asRecord(hit.brand).name) }
}

// JAN の商品情報を引く。収録漏れのときは null (エラーではない)。
// タイムアウトは呼び出し側が signal で持つ (external/productLookup.ts)。
export async function fetchProduct(
  jan: string,
  signal?: AbortSignal,
): Promise<ProductSummary | null> {
  const appid = yahooShoppingAppIdEnv()
  if (!appid) {
    // キー未設定は収録漏れと同じ「無い」に落とし、新規登録の導線は止めない
    // (docs/14 §1)。ただし黙ると設定漏れに気づけないので 1 行残す
    console.warn(
      'YAHOO_SHOPPING_APP_ID が未設定のため、商品情報は取得しません',
    )
    return null
  }
  const res = await fetch(yahooShoppingUrl(jan, appid), { signal })
  if (!res.ok) {
    // URL は載せない (Client ID が入っている)
    throw new Error(`Yahoo!ショッピングが HTTP ${res.status} を返しました`)
  }
  return parseYahooShoppingResponse(await res.json())
}
