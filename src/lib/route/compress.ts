// 大きな JSON・SVG を返す口 (docs/118 §4-1・docs/124)。
//
// 以前はここで gzip / brotli に圧縮し、Content-Encoding を付けて返していた。
// Next 16.4.5 (GHSA-pc58-hwjq-p385 の修正) から、Route Handler が返した
// Content-Encoding と Content-Length は送出時に捨てられる (fetch() の応答と自作の
// 応答を見分けられないため)。自前で圧縮すると、圧縮済みのバイト列がヘッダなしで
// 届き、端末は JSON として読めなくなる。
//
// そこで本文は素のまま返し、圧縮は next start の圧縮 (gzip・1KB 以上・
// 非同期のストリーム) に任せる。16.4.6 から Route Handler の応答も対象になった
// (vercel/next.js#101220)。brotli は使えなくなり、docs/124 §3 の 1〜3 割の縮みは失う。
//
// respond.ts (封筒の組み立て) に混ぜないのは、あちらが next/server だけを読む
// 葉で、proxy.ts からも使われるため。関数名は呼び出し側を変えないために残す。
import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { PageMeta } from './respond'

const NO_STORE = 'no-store'

// 圧縮の強さ (docs/122 §3)。本番のダンプの同期 (JSON 8.8MB) を手元で測った:
//   level 1: 2.76MB 65ms / 4: 2.36MB 78ms / 6 (既定): 2.24MB 121ms
// 4 は既定より 35% 速く、増えるのは 0.12MB (キャリアの 51Mbps で約 19ms)。
// 1 は 0.5MB 増えて、縮んだ時間を回線で取り戻されるので取らない。
// 今は応答では使わず、ベンチ (diag/serverBench.ts の同期の組み立て) だけが使う
export const SYNC_GZIP_LEVEL = 4

// brotli の品質 (docs/124 §3)。本文が文字列 (Markdown・SVG) の応答で、gzip の
// level 4 と同じくらいの時間で 2〜3 割小さくなる所を取る。11 は数百倍遅く、
// 応答のたびに圧縮する用途には使えない
export const BROTLI_QUALITY = 5

// 大きな本文 (オフライン同期の全件、11MB) は品質を下げる (docs/124 §8)。
// 本番で品質 5 は 486ms かかり、gzip 4 (211ms) の倍を超えた。手元の 11MB で
//   gzip 4: 2,435KB 77ms / br 3: 2,218KB 61ms / br 4: 2,032KB 97ms / br 5: 1,845KB 130ms
// 3 は gzip 4 より速くて小さい。5 との差 370KB はキャリアの 8.8Mbps で約 340ms と
// 縮む CPU 時間とほぼ同じだが、差分の同期が入って全件は稀になり、3 スレッドの
// VPS で他の要求と CPU を取り合う時間を減らすほうを取る
export const BROTLI_LARGE_QUALITY = 3
export const BROTLI_LARGE_BYTES = 1024 * 1024

export function brotliQualityFor(bytes: number): number {
  return bytes >= BROTLI_LARGE_BYTES ? BROTLI_LARGE_QUALITY : BROTLI_QUALITY
}

export async function apiOkGzip<T>(
  data: T,
  _request: Request,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<NextResponse> {
  return jsonEnvelope({ success: true, data, error: null }, extraHeaders)
}

// 検索の口 (docs/129 §2)。本文のハッシュを ETag に付け、端末が If-None-Match で
// 同じ値を送ってきたら 304 で本文を送らない。
//
// **本文を組んでからハッシュする** (同期の口のような安い問い合わせの版は作らない)。
// 検索の本文は数十〜数百 KB で、DB の読みは払うことになるが、運ぶ量と端末の
// 読み直し・描き直しが消える。sha1 は 300KB で 1ms 未満
export async function apiOkPagedGzip<T>(
  data: T,
  meta: PageMeta,
  request: Request,
): Promise<NextResponse> {
  const body = JSON.stringify({ success: true, data, error: null, meta })
  const etag = bodyEtag(body)
  if (etagMatches(request.headers.get('if-none-match'), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': NO_STORE, Vary: 'Accept-Encoding' },
    })
  }
  return jsonBody(body, { ETag: etag })
}

// 引用符つきの強い ETag
export function bodyEtag(body: string): string {
  return `"${createHash('sha1').update(body).digest('base64url')}"`
}

// 送られてきた If-None-Match が本文の ETag と同じか。nginx の gzip は強い ETag を
// 弱い印 (W/) に書き換えて渡すので、端末はそれを送り返してくる。W/ を外して比べる
export function etagMatches(header: string | null, etag: string): boolean {
  if (header === null) {
    return false
  }
  return header
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === etag || tag === '*')
}

function jsonEnvelope(
  envelope: Readonly<Record<string, unknown>>,
  extraHeaders: Readonly<Record<string, string>>,
): NextResponse {
  return jsonBody(JSON.stringify(envelope), extraHeaders)
}

function jsonBody(body: string, extraHeaders: Readonly<Record<string, string>>): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': NO_STORE,
      Vary: 'Accept-Encoding',
      ...extraHeaders,
    },
  })
}

export async function compressedTextResponse(
  body: string,
  _request: Request,
  headers: Readonly<Record<string, string>>,
): Promise<NextResponse> {
  return new NextResponse(body, { status: 200, headers: { Vary: 'Accept-Encoding', ...headers } })
}
