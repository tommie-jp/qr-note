import type { NextResponse } from 'next/server'
import { isDemoMode } from '@/lib/appEnv'
import { lookupBook } from '@/lib/external/bookLookup'
import { saveCoverImage } from '@/lib/external/coverImage'
import { externalLookup, type ExternalLookupSpec } from '@/lib/route/lookup'
import { isIsbn } from '@/lib/external/scanRegister'

// ISBN の書誌を返す (設計は docs/13-書誌自動取得計画.md)。
// 書影も付ける (docs/19-書影取得計画.md)。
//
// スキャンした ISBN の書名・著者をエディタに事前入力するために、
// 編集ページのクライアントから引かれる。
//
// サーバを挟むのは NDL サーチのため。NDL の口のうち速いほう (OpenSearch) は
// CORS ヘッダを返さずブラウザから直接引けず、CORS を返す SRU の口は
// 未キャッシュの ISBN で 14〜42 秒かかって実用にならなかった (実測)。
//
// 見つからない (data: null) はエラーではない。呼び出し側は事前入力のまま
// 手で書けばよく、導線は止まらない。
const BOOK_LOOKUP: ExternalLookupSpec<'isbn'> = {
  param: 'isbn',
  // 外から来る値なので必ず検算する。13 桁の数字だけを外部 API の URL に
  // 載せることになり、書籍以外のコードで NDL を叩くこともなくなる
  isValidCode: isIsbn,
  invalidCodeMessage: 'ISBN ではありません',
  // **書誌はデモでも引く** (docs/45-デモ書誌開放計画.md) ので demoDisabledMessage は
  // 持たない。書名・著者は openBD/NDL のキー不要 API で取れる (external/bookLookup.ts) ので、
  // デモでもスキャンから事前入力まで動かせる。JAN (/api/products) は Yahoo キーが
  // 本質的に要るので、あちらだけ demoDisabled を残す。
  // 書影の扱いだけは lookupBookWithCover でデモを分ける (§4-2)。
  lookup: lookupBookWithCover,
  // 個々の API の失敗は lookupBook が警告に残して次を試す。ここに来るのは
  // 想定外の取りこぼしなので、中身は返さずログに残す
  failureMessage: '書誌の取得に失敗しました',
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ isbn: string }> },
): Promise<NextResponse> {
  // 中身は公開情報 (書誌) だが、この口は NDL を叩く踏み台でもある。
  // 開けておくと、誰でもこのサーバ経由で外部 API を好きなだけ引ける。
  //
  // ログイン検査だけでは足りない。この口は**書影を DB に書き、楽天の
  // クォータを使う GET** なので、第三者のページの <img src> から動かされると
  // 孤児の書影とクォータをいくらでも焚かれる (docs/18 §9 / docs/19 §3)。
  // 門番 (ログイン + クロスサイト) は externalLookup が最初に通す
  return externalLookup(request, params, BOOK_LOOKUP)
}

async function lookupBookWithCover(isbn: string) {
  const book = await lookupBook(isbn)
  // 書誌が無ければ書影も引かない。事前入力に載せる見出しごと無いので、
  // 書影だけ取っても置き場所がない (外部 API を叩くだけ無駄になる)
  if (!book) {
    return null
  }
  return {
    ...book,
    // openBD の書影 URL はサーバの中だけの中継地点。本文に置くのは
    // 保存後の /api/images/<uuid>.jpg なので、応答には載せない
    coverUrl: undefined,
    // **デモでは書影を保存しない** (docs/45 §4-2)。openBD 書影はキー不要で
    // 引けるが、saveCoverImage は images へ書き込む副作用があり、それが
    // デモの容量クォータ (checkDemoUploadQuota) の外なので、書誌 (書名・
    // 著者) だけ返す。楽天書影はそもそもデモにキーが無く出ない
    coverImageUrl: isDemoMode() ? undefined : await saveCoverImage(isbn, book.coverUrl),
  }
}
