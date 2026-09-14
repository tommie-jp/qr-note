// バイト列を返す応答の組み立て (docs/93-リファクタリング計画.md §3-3)。
//
// 添付 (api/images/[name])・シークレットの暗号文 (api/secrets/[name])・
// エクスポートの ZIP (api/export) が使う。封筒 (respond.ts) と違って本文が
// JSON ではないので、ヘッダの揃え方だけをここに置く。

import { NextResponse } from 'next/server'
import { resolveByteRange } from '@/lib/route/httpRange'

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

// Range に応える配信。音声 (<audio>) のシークに要る
// (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。Range ヘッダが無ければ
// 全体を 200 で返すので、画像が同じ経路を通っても挙動は変わらない。
export function rangedBytesResponse(
  request: Request,
  data: Uint8Array,
  headers: Readonly<Record<string, string>>,
): NextResponse {
  const size = data.byteLength
  const base = {
    ...headers,
    // Range を解さないクライアントにも「部分取得できる」と知らせる
    'Accept-Ranges': 'bytes',
  }

  const range = resolveByteRange(request.headers.get('range'), size)
  if (range === 'unsatisfiable') {
    return new NextResponse(null, {
      status: 416,
      headers: { ...base, 'Content-Range': `bytes */${size}` },
    })
  }
  if (range) {
    const slice = data.subarray(range.start, range.end + 1)
    return new NextResponse(new Uint8Array(slice), {
      status: 206,
      headers: {
        ...base,
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      },
    })
  }

  return new NextResponse(new Uint8Array(data), { headers: base })
}
