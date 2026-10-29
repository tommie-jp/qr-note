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
// 検索の口 (/api/items・/api/trash) も使う (docs/123 §11-6)。端末で描くように
// なって一覧の材料が JSON で流れ、回路図サムネの多い検索は 500KB になった
// (旧版の RSC は gzip で 185KB)。
//
// 圧縮は**非同期** (docs/122 §3)。zlib は libuv のスレッドプールで走るので、
// 圧縮の間も Node のイベントループが空き、同期と重なった検索が待たない
// (gzipSync のときは本番で 292ms、ほかの要求が止まっていた)。本文は
// JSON.stringify で既に 1 本の文字列になっているので、ストリームにしても山は
// 変わらない。
import { promisify } from 'node:util'
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib'
import { NextResponse } from 'next/server'
import type { PageMeta } from './respond'

const NO_STORE = 'no-store'

// 圧縮の強さ (docs/122 §3)。本番のダンプの同期 (JSON 8.8MB) を手元で測った:
//   level 1: 2.76MB 65ms / 4: 2.36MB 78ms / 6 (既定): 2.24MB 121ms
// 4 は既定より 35% 速く、増えるのは 0.12MB (キャリアの 51Mbps で約 19ms)。
// 1 は 0.5MB 増えて、縮んだ時間を回線で取り戻されるので取らない。
// ベンチ (diag/serverBench.ts の同期の組み立て) も同じ値で測る
export const SYNC_GZIP_LEVEL = 4

// brotli の品質 (docs/124 §3)。本文が文字列 (Markdown・SVG) の応答で、gzip の
// level 4 と同じくらいの時間で 2〜3 割小さくなる所を取る。11 は数百倍遅く、
// 応答のたびに圧縮する用途には使えない
export const BROTLI_QUALITY = 5

const gzipAsync = promisify(gzip)
const brotliAsync = promisify(brotliCompress)

type Encoding = 'br' | 'gzip'

// 相手が受ける符号化。brotli を先に見る。ブラウザが br を送るのは HTTPS のとき
// だけ (手元の http では gzip のまま)。q=0 は「受けない」の意味なので外す
export function acceptedEncoding(request: Request): Encoding | null {
  const accepted = new Set(
    (request.headers.get('accept-encoding') ?? '')
      .split(',')
      .map((token) => token.trim().split(';'))
      .filter(([, q]) => q === undefined || !/^q=0(?:\.0*)?$/.test(q.trim()))
      .map(([name]) => name.trim().toLowerCase()),
  )
  if (accepted.has('br')) {
    return 'br'
  }
  return accepted.has('gzip') ? 'gzip' : null
}

async function compress(body: string, encoding: Encoding): Promise<Buffer> {
  if (encoding === 'br') {
    return brotliAsync(body, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(body),
      },
    })
  }
  return gzipAsync(body, { level: SYNC_GZIP_LEVEL })
}

// これより小さい本文は圧縮しない。gzip の頭と手間の方が縮む分より大きい
export const GZIP_MIN_BYTES = 1024

// apiOk と同じ封筒 ({ success, data, error }) と no-store。相手が gzip を
// 受けるときだけ Content-Encoding を付けて圧縮して返す
export async function apiOkGzip<T>(
  data: T,
  request: Request,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<NextResponse> {
  return gzipEnvelope({ success: true, data, error: null }, request, extraHeaders)
}

// apiOkPaged (respond.ts) と同じ封筒に meta を載せて、同じ作法で圧縮する
export async function apiOkPagedGzip<T>(
  data: T,
  meta: PageMeta,
  request: Request,
): Promise<NextResponse> {
  return gzipEnvelope({ success: true, data, error: null, meta }, request, {})
}

async function gzipEnvelope(
  envelope: Readonly<Record<string, unknown>>,
  request: Request,
  extraHeaders: Readonly<Record<string, string>>,
): Promise<NextResponse> {
  const body = JSON.stringify(envelope)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': NO_STORE,
    Vary: 'Accept-Encoding',
    ...extraHeaders,
  }
  const encoding = acceptedEncoding(request)
  if (encoding === null || body.length < GZIP_MIN_BYTES) {
    return new NextResponse(body, { status: 200, headers })
  }
  const compressed = await compress(body, encoding)
  return new NextResponse(new Uint8Array(compressed), {
    status: 200,
    headers: { ...headers, 'Content-Encoding': encoding },
  })
}

// 封筒に入れない文字列 (回路図の SVG など) を、同じ作法で圧縮して返す
// (docs/124 §1)。Content-Type と Cache-Control は呼ぶ側が決める
export async function compressedTextResponse(
  body: string,
  request: Request,
  headers: Readonly<Record<string, string>>,
): Promise<NextResponse> {
  const encoding = acceptedEncoding(request)
  const base = { Vary: 'Accept-Encoding', ...headers }
  if (encoding === null || body.length < GZIP_MIN_BYTES) {
    return new NextResponse(body, { status: 200, headers: base })
  }
  const compressed = await compress(body, encoding)
  return new NextResponse(new Uint8Array(compressed), {
    status: 200,
    headers: { ...base, 'Content-Encoding': encoding },
  })
}
