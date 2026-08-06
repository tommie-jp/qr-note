import { NextResponse } from 'next/server'
import { denyIfDemoMode, denyUnlessLoggedIn } from '@/lib/apiAuth'
import { importEnex } from '@/lib/enex/importEnex'
import { enexTooLargeMessage, MAX_ENEX_BYTES } from '@/lib/enex/limits'
import {
  checkUploadRequest,
  MULTIPART_OVERHEAD_BYTES,
} from '@/lib/uploads'
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
// **サーバ側で変換する**。クライアントは端末のファイルを選んで送るだけで、
// 展開も ENML → Markdown も添付の保存もここから先で行う。画像アップロード
// (/api/images) と同じ構図なので、認証・CSRF・大きさの作法もそちらに揃える。
export async function POST(request: Request): Promise<NextResponse> {
  // デモでは取り込みを閉じる (docs/38 §4)。ログインの有無より前に断つ。
  // ログインしていない相手のために 10MB を読む理由もない (/api/images と同じ順)
  const denied = denyIfDemoMode() ?? (await denyUnlessLoggedIn())
  if (denied) {
    return denied
  }

  const rejection = checkUploadRequest(
    request,
    Math.max(MAX_ENEX_BYTES, MAX_ZIP_BYTES) + MULTIPART_OVERHEAD_BYTES,
  )
  if (rejection) {
    return errorResponse(rejection.status, rejection.error)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (error) {
    // 本文の作りが違う (= 利用者に直せる) 話として 400 を返すが、原因はログに
    // 残す。境界を壊すのは multipart の書き方だけではない — 途中で切れた通信や
    // 境界を書き換えるプロキシもここへ来るので、握り潰すと切り分けられなくなる
    console.error('インポートの multipart 解析に失敗しました:', error)
    return errorResponse(400, 'multipart/form-data で file を送信して下さい')
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return errorResponse(400, 'file フィールドがありません')
  }

  // **形式は名前ではなく中身の先頭で決める**。拡張子は利用者が付け替えられる
  // うえ、共有アプリ経由だと落ちていることもある。判定は展開する側
  // (lib/zip/readZip.ts) と同じ関数を使う — 振り分けと展開が「ZIP とは何か」で
  // 食い違うと、振り分けだけ通って展開で落ちる組み合わせができる
  const head = new Uint8Array(await file.slice(0, ZIP_SIGNATURE_BYTES).arrayBuffer())
  return isZipBytes(head) ? importZipFile(file, formData) : importEnexFile(file)
}

async function importZipFile(file: File, formData: FormData): Promise<NextResponse> {
  // Content-Length を偽った要求に備え、読み込んだ実体でも確かめる。
  // 正規のブラウザはクライアント側の事前検査 (NotesImporter) で先に止まる
  if (file.size > MAX_ZIP_BYTES) {
    return errorResponse(413, zipTooLargeMessage(file.size))
  }

  // 既にある番号を上書きするか (§5)。**既定は上書きしない** — 送られて
  // こなければ安全側に倒れる形にしておく
  const overwrite = formData.get('overwrite') === '1'

  try {
    const report = await importZip(
      new Uint8Array(await file.arrayBuffer()),
      { overwrite },
    )
    return NextResponse.json({
      success: true,
      data: { format: 'zip', ...report },
      error: null,
    })
  } catch (error) {
    // ファイル 1 枚まるごとが対象外だったということ (ZIP として壊れている、
    // 大きすぎる、項目が多すぎる)。個々のノートの失敗はここへ来ず skipped に載る
    console.error('ZIP の取り込みに失敗しました:', error)
    return errorResponse(
      400,
      error instanceof Error ? error.message : 'ZIP を読み込めませんでした',
    )
  }
}

async function importEnexFile(file: File): Promise<NextResponse> {
  if (file.size > MAX_ENEX_BYTES) {
    return errorResponse(413, enexTooLargeMessage(file.size))
  }

  try {
    // text() は常に UTF-8 として読む (壊れた並びは U+FFFD に置き換わるだけで
    // 例外にはならない)。別の符号化で書かれたファイルは、化けたまま取り込まれる
    // より断りたいので、宣言との食い違いを parseEnex 側で見て投げている
    const report = await importEnex(await file.text())
    return NextResponse.json({
      success: true,
      data: { format: 'enex', ...report },
      error: null,
    })
  } catch (error) {
    // ファイル 1 枚まるごとが対象外だったということ (XML として壊れている、
    // ENEX ではない)。利用者に直せる話なので 400 で理由を返す
    console.error('ENEX の取り込みに失敗しました:', error)
    return errorResponse(
      400,
      error instanceof Error ? error.message : 'ENEX を読み込めませんでした',
    )
  }
}
