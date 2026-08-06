// 「受け取ったバイト列を添付として保存する」判断を 1 箇所に集めた入口。
//
// 手で貼ったアップロード (/api/images の POST)、ENEX インポート
// (docs/28-エクスポート計画.md §4)、書き出した ZIP の復元 (同 §3) の 3 経路から
// 呼ぶ。**形式の判定と変換を 3 か所に書くと必ずどれかだけ古くなる** — 実際
// uploads.ts のコメントが「名前の作り方を 2 通りに散らすと片方だけトラバーサル
// 対策が抜ける」と書いているのと同じ理由で、判定側もここへ寄せる。
//
// 形式は申告された MIME ではなく**中身のバイト列**で決める。ENEX の
// <resource><mime> も ZIP の中の拡張子も書き出し元の申告でしかなく、信用する
// 理由がない (新規保存の storeAttachment と復元の restoreAttachment で、
// 何を手がかりにするかだけが違う。理由はそれぞれの関数に書いた)。

import {
  restoreAttachmentRow,
  saveImage,
  type SaveImageOptions,
  savePlainAttachment,
} from './imageStore'
import { moveMoovToFront } from './mp4Faststart'
import { MAX_ZIP_FILE_BYTES } from './zip/limits'
import { normalizeImage } from './normalizeImage'
import { makeThumbnail } from './thumbnail'
import { hasUtf16Bom, normalizeTextBytes } from './normalizeText'
import {
  audioSaveInfo,
  type ImageFormat,
  isValidAudioName,
  isValidImageName,
  isValidPdfName,
  isValidVideoName,
  isValidVideoThumb,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  mimeForName,
  PDF_EXT,
  PDF_MIME,
  sniffAudioFormat,
  sniffImageFormat,
  sniffPdf,
  sniffVideoFormat,
  textSaveInfo,
  tooLargeMessage,
  videoSaveInfo,
} from './uploads'

export const UNSUPPORTED_ATTACHMENT_MESSAGE =
  '対応していない形式です (画像: png/jpg/gif/webp/avif/heic/tiff, 音声: mp3/m4a/wav/webm, 動画: mp4/webm/mov, PDF: pdf, テキスト: txt/csv/md)'

export interface StoreAttachmentOptions extends SaveImageOptions {
  // 1 件あたりの上限 (既定: MAX_IMAGE_BYTES = 10MB)。
  //
  // 既定値は **HTTP でアップロードする経路の都合**で決まっている — エッジ
  // (Caddyfile / deploy/nginx) のボディ上限 12MB に収まる大きさ。DB に
  // 置ける大きさの上限ではない。
  //
  // ファイルから直接読む一括取り込み (scripts/importEnex.ts) は HTTP を
  // 通らないので、この制限を課す理由がない。実際、iPhone の写真は 10MB を
  // 普通に超える (手元の書き出しでは 10 枚中 3 枚が 11〜12MB)。
  //
  // 判定は**変換前のバイト列**に対して行う点に注意。HEIC は保存時に WebP へ
  // 縮むが、その前にここで弾かれる
  maxBytes?: number

  // 元のファイル名 (アップロードなら File.name、ENEX なら file-name 属性)。
  //
  // **テキストだけがこれを要る。** 画像・音声・PDF は中身から形式が決まるが、
  // txt / csv / md は中身が同じなので拡張子でしか区別できない (uploads.ts の
  // textSaveInfo)。申告をそのまま保存名にはせず、既知の 3 つへ写すだけ。
  // 無ければ txt として保存する
  fileName?: string | null

  // 動画の poster に使う WebP サムネ。クライアントが先頭フレームから作って
  // 同じ POST で送る (docs/14 §Phase3)。**動画と判定されたときだけ**使い、
  // WebP かつ 200KB 以下でなければ捨てる (isValidVideoThumb)。無ければ
  // poster なしで保存する (配信側が 404 を返し、ブラウザは poster を無視する)。
  // ENEX インポートなど動画を伴わない経路では渡らない。
  videoThumb?: Uint8Array<ArrayBuffer> | null
}

export type AttachmentResult =
  | {
      ok: true
      // 本文から参照する URL (/api/images/<name>)
      url: string
      // 保存名。取り消し (インポートの巻き戻し) で行を消すために返す
      name: string
      // 画像なら本文に ![](url) で貼れる。音声・PDF はリンクにする
      isImage: boolean
    }
  | { ok: false; reason: string }

// 保存できたら url / name を、できなければ理由を返す。
//
// **例外は投げない**。呼び出し側は「1 件だめでも残りは続ける」(インポート) と
// 「400 で断る」(アップロード) のどちらかで、どちらも理由の文字列が要る。
export async function storeAttachment(
  // Prisma の Bytes は ArrayBuffer 実体の Uint8Array だけを受ける
  bytes: Uint8Array<ArrayBuffer>,
  options: StoreAttachmentOptions = {},
): Promise<AttachmentResult> {
  // 動画は他形式より上限が大きい (30MB) ので、共通の 10MB 検査より**先に**
  // 判定する。先に maxBytes=10MB で弾くと、30MB まで許すはずの動画が入らない。
  // 音声のみのファイルは映像トラックを持たず sniffVideoFormat が null を返すので、
  // ここで音声を取り違えることはない (uploads.ts sniffVideoFormat のコメント)。
  const videoFormat = sniffVideoFormat(bytes)
  if (videoFormat) {
    if (bytes.byteLength > MAX_VIDEO_BYTES) {
      return { ok: false, reason: tooLargeMessage(MAX_VIDEO_BYTES) }
    }
    // 動画も素通し保存。mp4/mov は moov を先頭へ移す (音声の m4a と同じ理由で、
    // 末尾 moov のままだと <video preload="metadata"> が再生を始められない)。
    // webm は ISO-BMFF ではないので moveMoovToFront が null を返す = 素通し。
    const { mime, ext } = videoSaveInfo(videoFormat)
    const stored =
      videoFormat === 'webm' ? bytes : (moveMoovToFront(bytes) ?? bytes)
    // クライアント生成の poster は**そのまま保存しない**。まず安い検査
    // (WebP かつ 200KB 以下) で弾き、通ったものも sharp で作り直す — 画像の
    // サムネと同じ経路 (makeThumbnail) に通すことで、解凍爆弾よけ
    // (MAX_INPUT_PIXELS) を効かせ、閲覧側のブラウザを巨大 WebP で落とせない
    // ようにする。作れなければ poster 無しで保存する (配信側が 404 を返す)。
    const thumb =
      options.videoThumb && isValidVideoThumb(options.videoThumb)
        ? await makeThumbnail(options.videoThumb, 'video poster')
        : null
    return succeed(await savePlainAttachment(stored, mime, ext, thumb), false)
  }

  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES
  if (bytes.byteLength > maxBytes) {
    return { ok: false, reason: tooLargeMessage(maxBytes) }
  }

  // まず画像として判定し、外れたら音声 (mp3/m4a/wav/webm)、PDF の順に試す
  const imageFormat = sniffImageFormat(bytes)
  if (imageFormat) {
    return storeImage(bytes, imageFormat, options)
  }

  // UTF-16 の BOM を持つテキストは、音声判定より**先に**確定させる。
  // UTF-16LE の BOM `FF FE` は緩い MP3 判定に音声として横取りされてしまう
  // (`FF FE` は MPEG1 Layer II の同期語としても妥当)。BOM + テキスト名なら
  // それはテキストなので、ここで決める。名前がテキストでない UTF-16 BOM
  // (稀な mp2 等) は null が返り、下の音声判定に委ねられる (normalizeText.ts)
  if (hasUtf16Bom(bytes)) {
    const asText = await tryStoreText(bytes, options)
    if (asText) {
      return asText
    }
  }

  const audioFormat = sniffAudioFormat(bytes)
  if (audioFormat) {
    // 音声は変換もサムネも要らない。中身をそのまま保存する。
    // 唯一の例外が m4a の moov 並べ替えで、これは変換ではなく**箱の詰め替え**
    // (音声データは 1 バイトも変わらない)。iOS Safari の録音とボイスメモは
    // moov が末尾に付き、そのままだと <audio> が再生を始められない
    const { mime, ext } = audioSaveInfo(audioFormat)
    const stored = audioFormat === 'm4a' ? (moveMoovToFront(bytes) ?? bytes) : bytes
    return succeed(await savePlainAttachment(stored, mime, ext), false)
  }

  if (sniffPdf(bytes)) {
    // PDF もそのまま保存し、表示はブラウザ内蔵ビューアに任せる
    return succeed(await savePlainAttachment(bytes, PDF_MIME, PDF_EXT), false)
  }

  // テキストは**最後に試す**。署名で決まる形式をすべて外してから見る
  // (先に置くと、たまたまテキストとして読めてしまう署名つきファイルを
  // 横取りしてしまう)。UTF-16 BOM だけは上で先に拾っている
  const asText = await tryStoreText(bytes, options)
  if (asText) {
    return asText
  }

  return { ok: false, reason: UNSUPPORTED_ATTACHMENT_MESSAGE }
}

// テキストとして保存できるか試す。判定は 2 つとも通ったときだけ:
//   1. 名前が txt/csv/md であること (uploads.ts textSaveInfo)
//   2. 中身がテキストとして読めること (normalizeText.ts)
// 名前だけでは中身がバイナリのものを受けてしまい、中身だけでは HTML や SVG が
// 名前を偽ったまま通ってしまう。中身は UTF-8 へ正規化されて保存される。
//
// 戻り値の 3 通り:
//   - null      … 名前がテキストでない (= テキストではない。別形式に委ねる)
//   - ok: false … 名前は合うが中身を読めなかった (これ以上は試さない)
//   - ok: true  … 保存できた
async function tryStoreText(
  bytes: Uint8Array<ArrayBuffer>,
  options: StoreAttachmentOptions,
): Promise<AttachmentResult | null> {
  const textInfo = textSaveInfo(options.fileName)
  if (!textInfo) {
    return null
  }
  const text = normalizeTextBytes(bytes)
  if (!text) {
    return { ok: false, reason: UNSUPPORTED_ATTACHMENT_MESSAGE }
  }
  return succeed(
    await savePlainAttachment(text, textInfo.mime, textInfo.ext),
    false,
  )
}

// 画像の保存 (HEIC/TIFF は WebP へ変換してから)。
async function storeImage(
  bytes: Uint8Array<ArrayBuffer>,
  format: ImageFormat,
  options: SaveImageOptions,
): Promise<AttachmentResult> {
  // ブラウザが表示できない形式 (HEIC/TIFF) は保存前に WebP へ変換する。
  // 復号に失敗する = 壊れた画像なので断る (500 にはしない)
  let normalized
  try {
    normalized = await normalizeImage(bytes, format)
  } catch (error) {
    // 失敗は握り潰さずログに残す (thumbnail.ts と同じ流儀)。「特定の 1 枚が
    // 壊れている」のか「HEIC 復号器が丸ごと動いていない」(alpine/musl の
    // イメージ更新後など) のかを、件数と形式で切り分けられるようにする
    console.error(
      `画像の正規化に失敗しました (${format}, ${bytes.byteLength} bytes):`,
      error,
    )
    return {
      ok: false,
      reason: '画像を読み込めませんでした (壊れているか未対応の画像です)',
    }
  }

  const url = await saveImage(
    normalized.bytes,
    normalized.mime,
    normalized.ext,
    options,
  )
  return succeed(url, true)
}

function succeed(url: string, isImage: boolean): AttachmentResult {
  return { ok: true, url, name: url.slice(url.lastIndexOf('/') + 1), isImage }
}

export type RestoreResult =
  // created=false は「同じ名前の行が既にある」= 二度目の取り込み
  | { ok: true; created: boolean }
  | { ok: false; reason: string }

// 書き出した ZIP の添付を**元の保存名のまま**戻す
// (docs/28-エクスポート計画.md §3)。
//
// storeAttachment との違いは「何で形式を決めるか」。アップロードは名前が
// 利用者由来なので**中身だけ**で決めるが、こちらの名前はこの DB が発番した
// UUID + 拡張子で、本文の参照がその名前を指している。そこで
// **拡張子が名乗る形式を、中身が裏付けるか**を見る形にする。順に試す
// storeAttachment と違って判定順の綾 (UTF-16 の BOM を MP3 と読む等) が
// 出ないぶん、こちらのほうが素直になる。
//
// 名乗りと中身が食い違うものは断る。ZIP は書き手が自由に作れるので、
// 「.png という名前の HTML」を保存して配信させない (配信側は DB の mime を
// そのまま Content-Type にする)。
export async function restoreAttachment(
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<RestoreResult> {
  const ext = name.slice(name.lastIndexOf('.') + 1)

  // 上限は種別で分けず「DB に入りうる最大」(MAX_ZIP_FILE_BYTES = CLI 取り込みの
  // 添付上限と同値) の 1 本にする。Web アップロードの 10MB/30MB は HTTP の
  // 都合であって器の上限ではなく、CLI から入った 12MB の写真を復元で弾くと
  // 「書き出せるのに戻せない」ができてしまう (実測で踏んだ)
  if (bytes.byteLength > MAX_ZIP_FILE_BYTES) {
    return { ok: false, reason: tooLargeMessage(MAX_ZIP_FILE_BYTES) }
  }

  if (isValidVideoName(name)) {
    const format = sniffVideoFormat(bytes)
    const info = format === null ? null : videoSaveInfo(format)
    return info === null || info.ext !== ext
      ? mismatch(ext)
      : store(name, bytes, info.mime)
  }

  if (isValidImageName(name)) {
    // heic/tiff は保存時に WebP へ変換されるので、その名前は発番されない。
    // 中身が heic のまま来たらここで食い違いとして落ちる。
    // 拡張子が一致した時点で mime は必ず引ける (どちらも MIME_TO_EXT が出どころ)
    const mime = sniffImageFormat(bytes) === ext ? mimeForName(name) : null
    return mime === null ? mismatch(ext) : store(name, bytes, mime)
  }

  if (isValidAudioName(name)) {
    const format = sniffAudioFormat(bytes)
    const info = format === null ? null : audioSaveInfo(format)
    return info === null || info.ext !== ext
      ? mismatch(ext)
      : store(name, bytes, info.mime)
  }

  if (isValidPdfName(name)) {
    return sniffPdf(bytes) ? store(name, bytes, PDF_MIME) : mismatch(PDF_EXT)
  }

  // 名前が txt/csv/md なら textSaveInfo は必ず引ける (同じ一覧が出どころ)。
  // 中身がテキストとして読めるかだけが残りの条件
  const textInfo = textSaveInfo(name)
  if (textInfo !== null) {
    const text = normalizeTextBytes(bytes)
    return text === null ? mismatch(ext) : store(name, text, textInfo.mime)
  }

  return { ok: false, reason: UNSUPPORTED_ATTACHMENT_MESSAGE }
}

// サムネを作るかは imageStore が決める (画像の行を作る入口はあちらの 3 つだけ)
async function store(
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): Promise<RestoreResult> {
  return { ok: true, created: await restoreAttachmentRow(name, bytes, mime) }
}

function mismatch(ext: string): RestoreResult {
  return {
    ok: false,
    reason: `中身が拡張子 (.${ext}) と一致しません`,
  }
}
