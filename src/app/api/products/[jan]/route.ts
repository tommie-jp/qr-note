import type { NextResponse } from 'next/server'
import { lookupProduct } from '@/lib/productLookup'
import { externalLookup, type ExternalLookupSpec } from '@/lib/route/lookup'
import { isJan } from '@/lib/scanRegister'

// JAN の商品情報を返す (設計は docs/14-JAN商品情報取得計画.md)。
// /api/books/[isbn] の商品版で、スキャンした JAN の商品名・ブランドを
// エディタに事前入力するために、編集ページのクライアントから引かれる。
//
// サーバを挟むのはキーの秘匿のため。Yahoo!ショッピングの Client ID を
// ブラウザから使うと全員に見える (books の CORS とは理由が違う)。
//
// 見つからない (data: null) はエラーではない。キー未設定もここに落ちる
// (yahooShopping.ts)。呼び出し側は事前入力のまま手で書けばよく、導線は止まらない。
const PRODUCT_LOOKUP: ExternalLookupSpec<'jan'> = {
  param: 'jan',
  // 外から来る値なので必ず検算する。13 桁の数字だけを外部 API の URL に
  // 載せることになり、ISBN は書籍側 (/api/books/) にしか行かない
  isValidCode: isJan,
  invalidCodeMessage: 'JAN ではありません',
  // デモインスタンスでは Yahoo! の Client ID を持たせない (docs/39-デモ公開計画.md §5)。
  // 黙って「見つかりませんでした」になるより、デモだと明示する (books と同じ扱い)。
  // 表示文言はクライアント (MemoEditor) 側
  demoDisabledMessage: 'デモ版では JAN 情報を取得できません',
  lookup: (jan) => lookupProduct(jan),
  // 「見つからなかった」ではなく「訊けなかった」。中身は返さずログに残す
  failureMessage: '商品情報の取得に失敗しました',
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jan: string }> },
): Promise<NextResponse> {
  // 開けておくと、こちらの Yahoo! の Client ID を使って誰でも商品検索でき、
  // API の利用枠をよそに使われる (キーを隠している意味がなくなる)。
  //
  // ログイン検査だけでは足りない。Basic 認証は SameSite が効かないので、
  // ログイン済みのブラウザが第三者のページを開くと <img src> ひとつで
  // ここが動き、Yahoo! の利用枠を焚かれる (docs/18 §9)。
  // 門番 (ログイン + クロスサイト) は externalLookup が最初に通す
  return externalLookup(request, params, PRODUCT_LOOKUP)
}
