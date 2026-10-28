// 大きな JSON を gzip で返す (docs/118 §4-1)。
//
// Next は Route Handler の JSON を圧縮せず (HTML と RSC は gzip で返る)、本番の
// nginx も既定 (gzip_proxied off) で上流の応答を圧縮しない。オフライン同期の
// 11MB がそのまま流れていたので、ここで自分で圧縮する。使うのは同期の口だけ
// (他の API は小さい)。
//
// respond.ts (封筒の組み立て) に混ぜないのは、あちらが next/server だけを読む
// 葉で、proxy.ts からも使われるため。zlib はここに閉じる。
//
// 同期で圧縮する (gzipSync)。本文は JSON.stringify で既に 1 本の文字列になって
// いるので、ストリームにしても山は変わらない。11MB → 約 2.3MB、手元で 80ms
import { gzipSync } from 'node:zlib'
import { NextResponse } from 'next/server'

const NO_STORE = 'no-store'

function acceptsGzip(request: Request): boolean {
  const accept = request.headers.get('accept-encoding') ?? ''
  return accept.split(',').some((token) => token.trim().split(';')[0] === 'gzip')
}

// apiOk と同じ封筒 ({ success, data, error }) と no-store。相手が gzip を
// 受けるときだけ Content-Encoding を付けて圧縮して返す
export function apiOkGzip<T>(
  data: T,
  request: Request,
  extraHeaders: Readonly<Record<string, string>> = {},
): NextResponse {
  const body = JSON.stringify({ success: true, data, error: null })
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': NO_STORE,
    Vary: 'Accept-Encoding',
    ...extraHeaders,
  }
  if (!acceptsGzip(request)) {
    return new NextResponse(body, { status: 200, headers })
  }
  const compressed = gzipSync(body)
  return new NextResponse(new Uint8Array(compressed), {
    status: 200,
    headers: { ...headers, 'Content-Encoding': 'gzip' },
  })
}
