// バイト列を返す応答の組み立て (docs/93-リファクタリング計画.md §3-3)。
//
// 添付 (api/images/[name])・シークレットの暗号文 (api/secrets/[name])・
// エクスポートの ZIP (api/export) が使う。封筒 (respond.ts) と違って本文が
// JSON ではないので、ヘッダの揃え方だけをここに置く。

import { NextResponse } from 'next/server'
import { type ByteRange, resolveByteRange } from '@/lib/route/httpRange'

export interface ByteHeaderOptions {
  readonly contentType: string
  readonly cacheControl: string
  // X-Robots-Tag: noindex を付けるか。付ける理由は口の側に書く
  readonly noindex?: boolean
  // 口ごとに足すヘッダ (Content-Disposition・復号後の種別など)
  readonly extra?: Readonly<Record<string, string>>
}

export function byteHeaders({
  contentType,
  cacheControl,
  noindex = false,
  extra = {},
}: ByteHeaderOptions): Record<string, string> {
  return {
    'Content-Type': contentType,
    ...extra,
    'Cache-Control': cacheControl,
    // ユーザー由来のバイト列を配信するため MIME スニッフィングを禁止
    'X-Content-Type-Options': 'nosniff',
    ...(noindex ? { 'X-Robots-Tag': 'noindex' } : {}),
  }
}

// 全体を 200 で返す。DB から来たバイト列は ArrayBuffer 実体へ写してから渡す
export function bytesResponse(
  data: Uint8Array,
  headers: Readonly<Record<string, string>>,
): NextResponse {
  return new NextResponse(new Uint8Array(data), { headers })
}

// Range を解さないクライアントにも「部分取得できる」と知らせる
export function withAcceptRanges(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  return { ...headers, 'Accept-Ranges': 'bytes' }
}

// 416: 形は読めたが範囲外 (RFC 7233 §4.4)
export function unsatisfiableRangeResponse(
  size: number,
  headers: Readonly<Record<string, string>>,
): NextResponse {
  return new NextResponse(null, {
    status: 416,
    headers: { ...withAcceptRanges(headers), 'Content-Range': `bytes */${size}` },
  })
}

// 206: 部分。slice は range の分だけ (呼び手が切り出して渡す)
export function partialBytesResponse(
  slice: Uint8Array,
  range: ByteRange,
  size: number,
  headers: Readonly<Record<string, string>>,
): NextResponse {
  return new NextResponse(new Uint8Array(slice), {
    status: 206,
    headers: {
      ...withAcceptRanges(headers),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    },
  })
}

// Range に応える配信。音声 (<audio>) のシークに要る
// (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。Range ヘッダが無ければ
// 全体を 200 で返すので、画像が同じ経路を通っても挙動は変わらない。
//
// **全体を手元に持っている**ときの形。添付の原寸 (api/images/[name]) は全体を
// 読まずに DB で切り出す (route 側。2026-11 の監査 M-11) ので、こちらは
// シークレットの暗号文など、全体を読む前提の口が使う
export function rangedBytesResponse(
  request: Request,
  data: Uint8Array,
  headers: Readonly<Record<string, string>>,
): NextResponse {
  const size = data.byteLength
  const range = resolveByteRange(request.headers.get('range'), size)
  if (range === 'unsatisfiable') {
    return unsatisfiableRangeResponse(size, headers)
  }
  if (range) {
    return partialBytesResponse(data.subarray(range.start, range.end + 1), range, size, headers)
  }
  return new NextResponse(new Uint8Array(data), { headers: withAcceptRanges(headers) })
}
