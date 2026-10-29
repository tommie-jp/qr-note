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
// 圧縮は**非同期** (docs/122 §3)。zlib は libuv のスレッドプールで走るので、
// 圧縮の間も Node のイベントループが空き、同期と重なった検索が待たない
// (gzipSync のときは本番で 292ms、ほかの要求が止まっていた)。本文は
// JSON.stringify で既に 1 本の文字列になっているので、ストリームにしても山は
// 変わらない。
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { NextResponse } from 'next/server'

const NO_STORE = 'no-store'

// 圧縮の強さ (docs/122 §3)。本番のダンプの同期 (JSON 8.8MB) を手元で測った:
//   level 1: 2.76MB 65ms / 4: 2.36MB 78ms / 6 (既定): 2.24MB 121ms
// 4 は既定より 35% 速く、増えるのは 0.12MB (キャリアの 51Mbps で約 19ms)。
// 1 は 0.5MB 増えて、縮んだ時間を回線で取り戻されるので取らない。
// ベンチ (diag/serverBench.ts の同期の組み立て) も同じ値で測る
export const SYNC_GZIP_LEVEL = 4

const gzipAsync = promisify(gzip)

function acceptsGzip(request: Request): boolean {
  const accept = request.headers.get('accept-encoding') ?? ''
  return accept.split(',').some((token) => token.trim().split(';')[0] === 'gzip')
}

// apiOk と同じ封筒 ({ success, data, error }) と no-store。相手が gzip を
// 受けるときだけ Content-Encoding を付けて圧縮して返す
export async function apiOkGzip<T>(
  data: T,
  request: Request,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<NextResponse> {
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
  const compressed = await gzipAsync(body, { level: SYNC_GZIP_LEVEL })
  return new NextResponse(new Uint8Array(compressed), {
    status: 200,
    headers: { ...headers, 'Content-Encoding': 'gzip' },
  })
}
