// 「受け取ったバイト列を添付として保存する」判断を 1 箇所に集めた入口。
//
// 手で貼ったアップロード (/api/images の POST)、ENEX インポート
// (docs/28-エクスポート計画.md §4)、書き出した ZIP の復元 (同 §3) の 3 経路から
// 呼ぶ。**形式の判定と変換を 3 か所に書くと必ずどれかだけ古くなる** — 実際
// images/imageStore.ts のコメントが「名前の作り方を 2 通りに散らすと片方だけトラバーサル
// 対策が抜ける」と書いているのと同じ理由で、判定側もここへ寄せる。
//
// 形式は申告された MIME ではなく**中身のバイト列**で決める。ENEX の
// <resource><mime> も ZIP の中の拡張子も書き出し元の申告でしかなく、信用する
// 理由がない (新規保存の storeAttachment と復元の restoreAttachment (restore.ts) で、
// 何を手がかりにするかだけが違う。理由はそれぞれの関数に書いた)。
//
// ここは**振り分けだけ**を持つ。形式ごとの保存は storeImage / storeVideo /
// storeAudio / storePdf / storeText に 1 分岐ずつ置く
// (docs/93-リファクタリング計画.md §4-5)。
import 'server-only'
import type { SaveImageOptions } from '@/lib/images/imageStore'
import { hasUtf16Bom } from '@/lib/text/normalizeText'
import { MAX_IMAGE_BYTES, tooLargeMessage } from '@/lib/uploads/limits'
import { sniffAudioFormat } from '@/lib/uploads/sniff/audio'
import { sniffImageFormat } from '@/lib/uploads/sniff/image'
import { sniffPdf } from '@/lib/uploads/sniff/pdf'
import { sniffVideoFormat } from '@/lib/uploads/sniff/video'
import { type AttachmentResult, UNSUPPORTED_ATTACHMENT_MESSAGE } from './result'
import { storeAudio } from './storeAudio'
import { storeImage } from './storeImage'
import { storePdf } from './storePdf'
import { tryStoreText } from './storeText'
import { storeVideo, type VideoThumbSources } from './storeVideo'

// videoThumb / videoFrames (動画のときだけ使うサムネの材料) は storeVideo.ts の
// VideoThumbSources に理由ごと置いてある
export interface StoreAttachmentOptions extends SaveImageOptions, VideoThumbSources {
  // 1 件あたりの上限 (既定: MAX_IMAGE_BYTES = 10MB)。
  //
  // 既定値は **HTTP でアップロードする経路の都合**で決まっている — エッジ
  // (Caddyfile / deploy/nginx) のボディ上限 35MB と、Next.js が proxy 経由の
  // 本文を複製できる量 (next.config.ts の proxyClientMaxBodySize = 31MB) に
  // 収まる大きさ。**その枠を丸ごと使うのは動画だけ**で、画像・音声・PDF・
  // テキストはここで 10MB に絞る。DB に置ける大きさの上限ではない。
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
  // txt / csv / md は中身が同じなので拡張子でしか区別できない (uploads/sniff/text.ts の
  // textSaveInfo)。申告をそのまま保存名にはせず、既知の 3 つへ写すだけ。
  // 無ければ txt として保存する
  fileName?: string | null
}

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
  // ここで音声を取り違えることはない (uploads/sniff/video.ts sniffVideoFormat のコメント)。
  const videoFormat = sniffVideoFormat(bytes)
  if (videoFormat) {
    return storeVideo(bytes, videoFormat, options)
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
  // (稀な mp2 等) は null が返り、下の音声判定に委ねられる (text/normalizeText.ts)
  if (hasUtf16Bom(bytes)) {
    const asText = await tryStoreText(bytes, options.fileName)
    if (asText) {
      return asText
    }
  }

  const audioFormat = sniffAudioFormat(bytes)
  if (audioFormat) {
    return storeAudio(bytes, audioFormat)
  }

  if (sniffPdf(bytes)) {
    return storePdf(bytes)
  }

  // テキストは**最後に試す**。署名で決まる形式をすべて外してから見る
  // (先に置くと、たまたまテキストとして読めてしまう署名つきファイルを
  // 横取りしてしまう)。UTF-16 BOM だけは上で先に拾っている
  const asText = await tryStoreText(bytes, options.fileName)
  if (asText) {
    return asText
  }

  return { ok: false, reason: UNSUPPORTED_ATTACHMENT_MESSAGE }
}
