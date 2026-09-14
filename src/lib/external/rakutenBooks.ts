// 楽天ブックス書籍検索 API との境界 (設計は docs/19-書影取得計画.md §2)。
//
// **書影のためだけに引く**。書誌 (書名・著者・出版社) は openBD → NDL サーチで
// 足りていて (docs/13)、ここは openBD が書影を持たない本を拾う担当。
//
// JPRO の規約改定で無料の書影配信が次々止まり (NDL 書影 API は 2026-03-31 に
// 終了、openBD の cover はホワイトリスト版元のみ)、実際に当たる書影の中で
// 明文の利用条件があるものがこれしか残らなかった (docs/19 §1)。
//
// openBD/NDL と違って鍵が要り、ブラウザから直接引くと全員に見える。
// 鍵の秘匿のためサーバでだけ動く (Yahoo!ショッピングと同じ事情)。
//
// 引くのに 3 つ要る (設計と実測は docs/19-書影取得計画.md §2)。
//
//   applicationId … アプリの識別子
//   accessKey     … 【NEW】の必須パラメータ。無いと 400
//   Origin ヘッダ … **楽天のアプリ登録で入れたサイト URL**。無いと 403。
//                   登録と違うドメインを送ると HTTP_REFERRER_NOT_ALLOWED
//
// 口も**新しいほう (openapi.rakuten.co.jp) でないと通らない**。旧 app.rakuten.co.jp
// は新しい形式の鍵を知らず、何を送っても 400 (specify valid applicationId) を返す。

import { rakutenBooksEnv } from '../appEnv'
import { asRecord, asString } from './book'

const ENDPOINT =
  'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404'

export function rakutenBooksUrl(
  isbn: string,
  applicationId: string,
  accessKey: string,
): string {
  const params = new URLSearchParams({
    applicationId,
    accessKey,
    isbn,
    // 使うのは 1 件目の書影だけ
    hits: '1',
    // Items をフラットにする (既定の 1 は要素を Item でくるむ)
    formatVersion: '2',
  })
  return `${ENDPOINT}?${params}`
}

// 応答 (JSON.parse 済み) から書影の URL を取り出す。無ければ空文字。
//
// 形は { count, hits, Items: [{ ..., largeImageUrl }] }。
// largeImageUrl でも 200x200 しかないので、無いときは中・小の順に落とす
// (書影が出ないよりは小さいほうがまし)。
export function parseRakutenCoverUrl(json: unknown): string {
  const items = asRecord(json).Items
  if (!Array.isArray(items)) {
    return ''
  }
  const entry = asRecord(items[0])
  // formatVersion=2 を指定しているが、外部 API の形は信用しない。
  // 既定 (Item でくるむ形) に戻されても書影を落とさない
  const item = asRecord(entry.Item ?? entry)
  return (
    asString(item.largeImageUrl) ||
    asString(item.mediumImageUrl) ||
    asString(item.smallImageUrl)
  )
}

// 失敗の本文から原因だけを取り出す。読めなければ空文字。
//
// 新しい口は { errors: { errorCode, errorMessage } }、旧い口と一部の経路は
// { error, error_description } / { statusCode, message } と形が揺れる。
// **鍵は載っていない** (載るのは URL のほうで、こちらは本文) ので、
// 分かる形だけ拾って設定ミスの手がかりにする。
async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = asRecord(await res.json())
    return (
      asString(asRecord(body.errors).errorMessage) ||
      asString(body.error_description) ||
      asString(body.message)
    )
  } catch {
    return '' // JSON ですらない
  }
}

// ISBN の書影 URL を引く。書影が無い・設定が足りなければ null (エラーではない)。
// タイムアウトは呼び出し側が signal で持つ (external/coverLookup.ts)。
export async function fetchCoverUrl(
  isbn: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const { appId: applicationId, accessKey, origin } = rakutenBooksEnv()
  if (!applicationId || !accessKey || !origin) {
    // 設定漏れは「書影なし」に落とし、新規登録の導線は止めない (docs/19 §3)。
    // ただし黙ると気づけないので 1 行残す。
    // **3 つ揃わないと引けない**ので、欠けているものを名指しする
    // (楽天のエラーはどれが悪いか教えてくれない)
    const missing = [
      !applicationId && 'RAKUTEN_APP_ID',
      !accessKey && 'RAKUTEN_ACCESS_KEY',
      !origin && 'RAKUTEN_APP_ORIGIN',
    ]
      .filter(Boolean)
      .join(' / ')
    console.warn(`${missing} が未設定のため、楽天からは書影を取得しません`)
    return null
  }
  let res: Response
  try {
    res = await fetch(rakutenBooksUrl(isbn, applicationId, accessKey), {
      signal,
      // アプリ登録したサイトからの呼び出しであることを示す。無いと 403
      // (REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING)。Referer では通らない
      headers: { Origin: origin },
    })
  } catch (err) {
    // 通信レベルの失敗 (DNS・TLS・中断)。ランタイムが投げた例外をそのまま
    // 上へ流すと、その中身 (URL を含みうる) がログに出る。いまの undici は
    // URL を載せないが、それに賭ける理由はない。鍵の入った URL を持たない
    // 例外に置き換える (中断だけは呼び出し側が signal で見分ける)
    throw new Error(`楽天ブックスに接続できませんでした: ${(err as Error).name}`)
  }
  if (!res.ok) {
    // URL は載せない (鍵が入っている)。楽天は原因を本文の errorMessage に書く
    // (HTTP_REFERRER_NOT_ALLOWED = Origin が登録と違う、など) ので、
    // 設定を直せるようそこだけ拾う
    const reason = await readErrorMessage(res)
    throw new Error(
      `楽天ブックスが HTTP ${res.status} を返しました${reason ? ` (${reason})` : ''}`,
    )
  }
  return parseRakutenCoverUrl(await res.json()) || null
}
