// 書影を取ってきて DB に保存するところまで (設計は docs/19-書影取得計画.md)。
//
// 取得の境界 (coverLookup) と保存 (imageStore) をつなぐだけの層。
// /api/books/[isbn] を薄いままにするために置いている。
//
// **何があっても throw しない**。書影が載らないだけで、書名・著者は
// 今までどおり入る (docs/19 §3)。

import { lookupCover } from './coverLookup'
import { saveImage } from '../imageStore'
import { withSourceTimeout } from './sourceTimeout'

// 書影の取得ぜんぶに与える上限。**書誌の事前入力が届くまでの時間**に
// そのまま乗るので、1 つの API に 8 秒 (SOURCE_TIMEOUT_MS) を許している書誌より
// 短く切る。書影は取得元が 2 つあり、上限を取得元ごとに持たせると、
// 全部が黙り込んだとき書名すら出ないまま 20 秒以上待たせることになる
// (docs/13-書誌自動取得計画.md §4 の「導線を吊るさない」)。
//
// 実測は書影ありで 19ms、無しで 0ms なので、まともに動いている限り当たらない。
const COVER_TIMEOUT_MS = 5000

// 書影を取って保存し、本文に置く URL ("/api/images/<uuid>.jpg") を返す。
// 取れなければ undefined。
//
// 保存はエディタを開いた時点で起きるので、ノートを保存せず離脱すると
// 参照されない行が images に残る。手で貼った画像と同じ挙動で、
// 書影は 6〜65KB (実測) と小さいため許容する (docs/19 §4)。
export async function saveCoverImage(
  isbn: string,
  openBdCoverUrl?: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  // 上限を超えたら lookupCover の中で中断が伝わり、null が返る (throw しない)
  const cover = await withSourceTimeout(
    signal,
    (s) => lookupCover(isbn, openBdCoverUrl, s),
    COVER_TIMEOUT_MS,
  )
  if (!cover) {
    return undefined
  }
  try {
    return await saveImage(cover.bytes, cover.mime, cover.ext)
  } catch (err) {
    // DB の失敗で書誌まで落とさない。ただし外部 API の「無かった」と違って
    // これは自分のところの故障なので、警告ではなくエラーとして残す
    // (書影が全部保存できなくなっても、warn だと埋もれて気づけない)
    console.error(`書影を保存できませんでした (isbn=${isbn})`, err)
    return undefined
  }
}
