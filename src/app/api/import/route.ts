import { NextResponse } from 'next/server'
import { denyIfDemoMode, denyUnlessLoggedIn } from '@/lib/apiAuth'
import { concatBytes } from '@/lib/bytes'
import { importEnex } from '@/lib/enex/importEnex'
import { enexTooLargeMessage, MAX_ENEX_BYTES } from '@/lib/enex/limits'
import { checkUploadRequest } from '@/lib/uploads'
import { importZip } from '@/lib/zip/importZip'
import { MAX_ZIP_BYTES, zipTooLargeMessage } from '@/lib/zip/limits'
import { isZipBytes, ZIP_SIGNATURE_BYTES } from '@/lib/zip/readZip'

function errorResponse(status: number, error: string): NextResponse {
  return NextResponse.json({ success: false, data: null, error }, { status })
}

// 取り込みの口 (docs/28-エクスポート計画.md §3 / §4)。
//
// 受けるのは 2 種類:
//   .zip  … このアプリが書き出したもの (§1 の形式) を番号ごと戻す
//   .enex … Evernote からの乗り換え (§4)。番号は新しく振る
//
// **本文はファイルそのもの** (multipart ではない)。ZIP は 500MB まで受けるので、
// formData() で包むと本文全体とその複製がメモリに載ってしまう (本番 VPS は
// RAM 2GB)。生のボディなら `request.body` をそのまま展開器へ流せて、載るのは
// 「いま保存している添付 1 件」だけになる。同時に送りたい設定 (上書きするか)
// はクエリに置く — 本文に混ぜないぶん、流し読みの邪魔にもならない。
//
// **サーバ側で変換する**。クライアントは端末のファイルを送るだけで、展開も
// ENML → Markdown も添付の保存もここから先で行う。
export async function POST(request: Request): Promise<NextResponse> {
  // デモでは取り込みを閉じる (docs/38 §4)。ログインの有無より前に断つ。
  // ログインしていない相手のために本文を読む理由もない (/api/images と同じ順)
  const denied = denyIfDemoMode() ?? (await denyUnlessLoggedIn())
  if (denied) {
    return denied
  }

  // Origin の検査 (CSRF) と、Content-Length を名乗った時点での足切り。
  // multipart を使わなくなったので余白は要らない
  const rejection = checkUploadRequest(request, MAX_ZIP_BYTES)
  if (rejection) {
    return errorResponse(rejection.status, rejection.error)
  }

  if (request.body === null) {
    return errorResponse(400, 'ファイルの中身が送られていません')
  }

  // 既にある番号を上書きするか (§5)。**送られてこなければ上書きしない**
  // 形にしておく (旗の欠落が無防備へ倒れない)
  const overwrite = new URL(request.url).searchParams.get('overwrite') === '1'

  try {
    return await dispatch(chunksOf(request.body), overwrite)
  } catch (error) {
    if (error instanceof UploadTooLargeError) {
      return errorResponse(413, error.message)
    }
    // ファイル 1 枚まるごとが対象外だったということ (ZIP として壊れている、
    // 項目が多すぎる、XML として読めない)。利用者に直せる話なので 400 で
    // 理由を返す。個々のノートの失敗はここへ来ずレポートの skipped に載る
    console.error('取り込みに失敗しました:', error)
    return errorResponse(
      400,
      error instanceof Error ? error.message : 'ファイルを読み込めませんでした',
    )
  }
}

// **形式は名前ではなく中身の先頭で決める**。拡張子は利用者が付け替えられる
// うえ、共有アプリ経由だと落ちていることもある。判定は展開する側
// (lib/zip/readZip.ts) と同じ関数を使う — 振り分けと展開が「ZIP とは何か」で
// 食い違うと、振り分けだけ通って展開で落ちる組み合わせができる。
async function dispatch(
  source: AsyncGenerator<Uint8Array>,
  overwrite: boolean,
): Promise<NextResponse> {
  const { head, rest } = await peek(source, ZIP_SIGNATURE_BYTES)

  if (isZipBytes(head)) {
    const report = await importZip(withLimit(rest, MAX_ZIP_BYTES, zipTooLargeMessage), {
      overwrite,
    })
    return NextResponse.json({
      success: true,
      data: { format: 'zip', ...report },
      error: null,
    })
  }

  // ENEX は変換が入力に比例してメモリを食う (docs/28 §4) ため上限が別で小さい。
  // 流し読みもできない (XML を丸ごと読んでから木にする) ので、ここで受けきる
  const xml = await readText(rest, MAX_ENEX_BYTES, enexTooLargeMessage)
  const report = await importEnex(xml)
  return NextResponse.json({
    success: true,
    data: { format: 'enex', ...report },
    error: null,
  })
}

// 上限を超えたことは 413 で返したい (400 の「読めなかった」とは違う話)
class UploadTooLargeError extends Error {}

function chunksOf(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  return (async function* () {
    // getReader() を使うのは、Node と undici のどちらの実装でも
    // 非同期反復が使えるとは限らないため
    const reader = body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          return
        }
        if (value.byteLength > 0) {
          yield value
        }
      }
    } finally {
      reader.releaseLock()
    }
  })()
}

// 流しながら大きさを見張る。**Content-Length は名乗りでしかない**ので、
// 実際に届いたバイト数で数え直す
async function* withLimit(
  source: AsyncGenerator<Uint8Array>,
  maxBytes: number,
  message: (actualBytes: number) => string,
): AsyncGenerator<Uint8Array> {
  let total = 0
  for await (const chunk of source) {
    total += chunk.byteLength
    if (total > maxBytes) {
      throw new UploadTooLargeError(message(total))
    }
    yield chunk
  }
}

// 先頭 n バイトを覗く。覗いたぶんは rest の先頭から改めて流れる
async function peek(
  source: AsyncGenerator<Uint8Array>,
  bytes: number,
): Promise<{ head: Uint8Array; rest: AsyncGenerator<Uint8Array> }> {
  const seen: Uint8Array[] = []
  let total = 0
  while (total < bytes) {
    const next = await source.next()
    if (next.done) {
      break
    }
    seen.push(next.value)
    total += next.value.byteLength
  }

  async function* rest(): AsyncGenerator<Uint8Array> {
    yield* seen
    yield* source
  }

  return { head: concatBytes(seen, total), rest: rest() }
}

async function readText(
  source: AsyncGenerator<Uint8Array>,
  maxBytes: number,
  message: (actualBytes: number) => string,
): Promise<string> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of withLimit(source, maxBytes, message)) {
    chunks.push(chunk)
    total += chunk.byteLength
  }
  // 常に UTF-8 として読む (壊れた並びは U+FFFD に置き換わるだけで例外に
  // ならない)。別の符号化で書かれたファイルは、化けたまま取り込まれるより
  // 断りたいので、宣言との食い違いを parseEnex 側で見て投げている
  return new TextDecoder().decode(concatBytes(chunks, total))
}
