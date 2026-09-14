// --- 動画 (41-QR-search/docs/14-動画挿入計画.md) ---
//
// 動画は音声と同じく変換もサムネ生成もサーバではしない。ブラウザが直接再生できる
// 形式だけを受け付け、images テーブルへそのまま bytes で保存し、そのまま配信する。
// 音声のスニッフが「動画トラックを持つものを弾く」のに対し、こちらは「動画
// トラックを持つもの**だけ**を受ける」— ちょうど裏返しの判定になる。
//
// サムネイル (poster) はクライアントが先頭フレームから WebP を作って別途送り、
// thumb カラムへ入れる (サーバに ffmpeg を持ち込まない)。
//
// 保存名と配信 mime の規則は names.ts、大きさの上限は limits.ts が持つ
// (docs/93-リファクタリング計画.md §4-2)。

import { MAX_VIDEO_ANIM_FRAME_BYTES, MAX_VIDEO_THUMB_BYTES } from '../limits'
import { containsMarker, startsWith } from './bytes'
import { sniffImageFormat } from './image'
import { findTopLevelBox, handlerTypesIn, readIsoBmffBrands } from './isoBmff'
import { EBML_MAGIC, WEBM_VIDEO_CODEC_IDS, WEBM_VIDEO_LEADS } from './webm'

// スニッフが返す**中身の形式**。保存拡張子とは分ける — webm 動画は中身は
// video/webm だが、保存名は `.mkv` に写す (video/videoFormats.ts の経緯: 音声のみの
// `.webm` と URL 上で衝突させない)。
export type VideoFormat = 'mp4' | 'webm' | 'mov'

const VIDEO_FORMAT_TO_MIME: Record<VideoFormat, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

// 中身の形式 → 保存名の拡張子。mp4/mov は形式名と同じ、webm 動画だけ `.mkv`。
const VIDEO_FORMAT_TO_EXT: Record<VideoFormat, string> = {
  mp4: 'mp4',
  webm: 'mkv',
  mov: 'mov',
}

// sniff で決めた中身の形式を、保存に使う mime / ext へ写す。
export function videoSaveInfo(format: VideoFormat): { mime: string; ext: string } {
  return { mime: VIDEO_FORMAT_TO_MIME[format], ext: VIDEO_FORMAT_TO_EXT[format] }
}

// QuickTime (.mov) の major brand。iPhone のカメラロール由来の mov を mp4 と
// 区別して mime を付けるために見る (再生自体はどちらもブラウザ任せ)。
const QUICKTIME_BRANDS = new Set(['qt  '])

// moov のトラックに映像 (vide) ハンドラがあるか。音声の hasAudioOnlyTracks の
// 裏返しで、ブランド名に依らずトラック種別で判定する (Safari の録画が名乗る
// iso5 系ブランドでも正しく拾える)。
function hasVideoTrack(bytes: Uint8Array): boolean {
  const moov = findTopLevelBox(bytes, 'moov')
  if (!moov) {
    return false
  }
  return handlerTypesIn(moov).includes('vide')
}

function sniffIsoBmffVideo(bytes: Uint8Array): VideoFormat | null {
  const brands = readIsoBmffBrands(bytes)
  if (!brands) {
    return null
  }
  // 映像トラックを持たない ISO-BMFF (音声だけの m4a など) は動画にしない
  if (!hasVideoTrack(bytes)) {
    return null
  }
  return brands.some((b) => QUICKTIME_BRANDS.has(b)) ? 'mov' : 'mp4'
}

// EBML (webm/matroska) で、映像 CodecID を含むものを動画として受ける。
// 音声側 (isWebmAudio) が映像 CodecID を見つけたら弾くのと同じ列挙 (裏返し)。
function isWebmVideo(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, EBML_MAGIC)) {
    return false
  }
  return containsMarker(
    bytes,
    WEBM_VIDEO_CODEC_IDS,
    WEBM_VIDEO_LEADS,
    bytes.byteLength,
  )
}

// 先頭バイトから動画形式を判定する。判定できなければ null (=非対応)。
// attachments/store.ts は音声判定より後にこれを試す (音声のみのファイルは
// hasVideoTrack が false になり、ここでも null になるので取り違えない)。
export function sniffVideoFormat(bytes: Uint8Array): VideoFormat | null {
  if (isWebmVideo(bytes)) {
    return 'webm'
  }
  return sniffIsoBmffVideo(bytes)
}

// クライアントが送ってきた動画サムネ (poster) が信用できるか。
//
// **形式は webp に限定しない。** canvas.toBlob('image/webp') は Safari (iOS) が
// 出せず PNG/JPEG に化けるため、webp 限定だと iPhone 録画に poster が付かない
// (実機報告)。クライアントは JPEG を出し、端末によっては PNG になる。sharp が
// 読める光栅画像 (sniffImageFormat が種別を返すもの = png/jpg/webp/gif/avif/tiff)
// なら受け、attachments/storeVideo.ts が makeThumbnail で webp へ作り直す。SVG は
// sniffImageFormat が弾く (スクリプト混入対策) ので、ここも自動で拒否される。
// 大きさは 200KB を超えないものだけ (MAX_VIDEO_THUMB_BYTES。バッファ済みの防波堤は
// route 側にもある)。
export function isValidVideoThumb(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > 0 &&
    bytes.byteLength <= MAX_VIDEO_THUMB_BYTES &&
    sniffImageFormat(bytes) !== null
  )
}

// 動くサムネのコマとして受け取ってよいバイト列か。判定の考え方は
// isValidVideoThumb と同じ (中身で決める / SVG は sniffImageFormat が弾く) で、
// 上限だけが違う。
export function isValidVideoAnimFrame(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > 0 &&
    bytes.byteLength <= MAX_VIDEO_ANIM_FRAME_BYTES &&
    sniffImageFormat(bytes) !== null
  )
}
