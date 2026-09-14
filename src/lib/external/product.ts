// 商品情報の共通の型 (設計は docs/14-JAN商品情報取得計画.md)。
//
// 書誌の BookSummary (external/book.ts) と対になる。いまの取得元は Yahoo!ショッピング
// 1 本 (external/yahooShopping.ts) だが、楽天などを足すときもこの形に均して受け取る。
//
// 価格は持たない。変動する値で、正本 (メモ本文) に固定する意味がない。

export interface ProductSummary {
  title: string
  brand: string
}
