import { NextResponse } from 'next/server'
import { denyIfDemoMode, denyUnlessLoggedIn } from '@/lib/apiAuth'
import { concatBytes } from '@/lib/bytes'
import { importEnex } from '@/lib/enex/importEnex'
import { enexTooLargeMessage, MAX_ENEX_BYTES } from '@/lib/enex/limits'
import { checkUploadRequest } from '@/lib/uploads'
import {
  CONFLICT_POLICY_ERROR,
  type ConflictPolicy,
  parseConflictPolicy,
} from '@/lib/zip/conflictPolicy'
import { importZip } from '@/lib/zip/importZip'
import { MAX_ZIP_BYTES, zipTooLargeMessage } from '@/lib/zip/limits'
import {
  beginImport,
  ImportBusyError,
  type ImportProgressHandle,
  releaseImport,
} from '@/lib/zip/importProgressStore'
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
// 「いま保存している添付 1 件」だけになる。同時に送りたい設定 (番号が衝突した
// ときの扱い) はクエリに置く — 本文に混ぜないぶん、流し読みの邪魔にもならない。
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

  // 同じ番号のノートが既にあるときどうするか (§5)。**送られてこなければ
  // そのまま残す** (旗の欠落が無防備へ倒れない)。知らない値は 400 で断る —
  // タイポが黙って skip で走ると「取り込めたのに増えていない」にしか見えない
  const params = new URL(request.url).searchParams
  // 旧い画面 (開きっぱなしのタブ) は ?overwrite=1 を投げてくる。黙って skip で
  // 走らせると「上書きしたのに変わらない」になるので、名前が変わったと伝える
  if (params.has('overwrite')) {
    return errorResponse(400, 'overwrite は廃止しました。conflict=overwrite を使って下さい')
  }
  const conflict = parseConflictPolicy(params.get('conflict'))
  if (conflict === null) {
    return errorResponse(400, CONFLICT_POLICY_ERROR)
  }

  // 進捗の控えを取る (docs/28 §9)。**取れなければ断る** — importZip は
  // 同時実行を想定しておらず (採番・衝突判定が競合する)、これは進捗以前に
  // 必要な門。Content-Length は名乗りだが、% の分母にはこれしかない
  let handle: ImportProgressHandle
  try {
    handle = beginImport(contentLength(request))
  } catch (error) {
    if (error instanceof ImportBusyError) {
      return errorResponse(409, error.message)
    }
    throw error
  }

  // 本文は 1 本の reader から読む。**読み手を握ったままにする**のが要点で、
  // 途中で抜けた後の読み捨て (drainRequest) が同じ続きから読めるようにする
  const reader = request.body.getReader()
  const received = { bytes: 0 }

  try {
    const response = await dispatch(chunksOf(reader, received), conflict, handle)
    handle.finish()
    return response
  } catch (error) {
    // **応答を返す前に、届いていない本文を読み捨てる**。理由は drainRequest に
    await drainRequest(reader, received, handle)
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
  } finally {
    reader.releaseLock()
    // **必ず空ける**。握ったまま抜けると次の取り込みが始められない
    releaseImport()
  }
}

// エラー応答を返す前に、まだ届いていない本文を読み捨てる。
//
// **読み切らないと応答が届かないことがある**。サーバが本文を読み終える前に
// 応答を返す形は、直結 (curl・localhost) なら早い応答として素直に届くが、
// 間に中継が挟まると話が変わる — 本番の nginx は /api/import だけ
// proxy_request_buffering off で中継しており、WSL のポート転送や社内 proxy も
// 同じ位置に立つ。中継はクライアントの送信を先に捌こうとするため、応答が
// 中継されないまま送信だけが続き、画面には**「取り込み中…」が出たきり何も
// 起きない**。残りを読んでやれば送信が終わり、理由付きのエラーが画面に出る。
//
// **読み捨ての上限は「まだ受け取ってよい残り」まで**。413 (大きすぎる) で
// 抜けたときは予算が尽きているので 1 バイトも読まない — 断った相手に
// 付き合って 500MB を読むのでは、上限を設けた意味がなくなる。
async function drainRequest(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  received: { bytes: number },
  handle: ImportProgressHandle,
): Promise<void> {
  let budget = MAX_ZIP_BYTES - received.bytes
  try {
    while (budget > 0) {
      const { done, value } = await reader.read()
      if (done) {
        return
      }
      budget -= value.byteLength
      // 読み捨てたぶんも進捗に数える。画面のバーは最後まで進み、
      // 送り終わったところでエラーが出る (止まったように見せない)
      handle.addBytes(value.byteLength)
    }
  } catch (error) {
    // 既に切れている・読めない。**返せる応答を返すほうが大事**なので、
    // ここで失敗しても本当のエラー (呼び出し側が持っている) を押しのけない
    console.error('残りの本文を読み捨てられませんでした:', error)
  }
}

// % の分母。名乗らない相手 (chunked) では null になり、割合は出さない
function contentLength(request: Request): number | null {
  const raw = request.headers.get('content-length')
  if (raw === null) {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

// **形式は名前ではなく中身の先頭で決める**。拡張子は利用者が付け替えられる
// うえ、共有アプリ経由だと落ちていることもある。判定は展開する側
// (lib/zip/readZip.ts) と同じ関数を使う — 振り分けと展開が「ZIP とは何か」で
// 食い違うと、振り分けだけ通って展開で落ちる組み合わせができる。
async function dispatch(
  source: AsyncGenerator<Uint8Array>,
  conflict: ConflictPolicy,
  handle: ImportProgressHandle,
): Promise<NextResponse> {
  const { head, rest } = await peek(source, ZIP_SIGNATURE_BYTES)

  if (isZipBytes(head)) {
    const report = await importZip(withLimit(rest, MAX_ZIP_BYTES, zipTooLargeMessage, handle), {
      conflict,
      onNotesStart: handle.startNotes,
      onNoteDone: handle.noteDone,
    })
    return NextResponse.json({
      success: true,
      data: { format: 'zip', ...report },
      error: null,
    })
  }

  // ENEX は変換が入力に比例してメモリを食う (docs/28 §4) ため上限が別で小さい。
  // 流し読みもできない (XML を丸ごと読んでから木にする) ので、ここで受けきる
  const xml = await readText(rest, MAX_ENEX_BYTES, enexTooLargeMessage, handle)
  const report = await importEnex(xml)
  return NextResponse.json({
    success: true,
    data: { format: 'enex', ...report },
    error: null,
  })
}

// 上限を超えたことは 413 で返したい (400 の「読めなかった」とは違う話)
class UploadTooLargeError extends Error {}

// 受け取った本文を流す。**読み手は呼び出し側が握ったまま**にする —
// ここで releaseLock すると、途中で抜けた後に残りを読み捨てられない。
// received は読み捨ての予算を決めるための控え (どこまで受け取ったか)。
function chunksOf(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  received: { bytes: number },
): AsyncGenerator<Uint8Array> {
  return (async function* () {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        return
      }
      received.bytes += value.byteLength
      if (value.byteLength > 0) {
        yield value
      }
    }
  })()
}

// 流しながら大きさを見張る。**Content-Length は名乗りでしかない**ので、
// 実際に届いたバイト数で数え直す
async function* withLimit(
  source: AsyncGenerator<Uint8Array>,
  maxBytes: number,
  message: (actualBytes: number) => string,
  // 数えたバイト数はそのまま進捗になる (docs/28 §9)。本番の nginx は
  // /api/import だけ proxy_request_buffering off なので、**ここで読めた量が
  // 実際にアップロードが進んだ量**になる
  handle: ImportProgressHandle,
): AsyncGenerator<Uint8Array> {
  let total = 0
  for await (const chunk of source) {
    total += chunk.byteLength
    if (total > maxBytes) {
      throw new UploadTooLargeError(message(total))
    }
    handle.addBytes(chunk.byteLength)
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
  handle: ImportProgressHandle,
): Promise<string> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of withLimit(source, maxBytes, message, handle)) {
    chunks.push(chunk)
    total += chunk.byteLength
  }
  // 常に UTF-8 として読む (壊れた並びは U+FFFD に置き換わるだけで例外に
  // ならない)。別の符号化で書かれたファイルは、化けたまま取り込まれるより
  // 断りたいので、宣言との食い違いを parseEnex 側で見て投げている
  return new TextDecoder().decode(concatBytes(chunks, total))
}
