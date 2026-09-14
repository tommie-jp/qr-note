// --- 音声 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md) ---
//
// 音声は画像と違い、変換もサムネも埋め込みもしない。ブラウザが直接再生できる
// 形式 (mp3/m4a/wav) だけを受け付け、images テーブルへそのまま bytes で保存し、
// そのまま配信する。images テーブルを流用するのは、pg_dump 一発でメモと一緒に
// バックアップできる利点 (images/imageStore.ts) を音声にも効かせるため。
//
// 保存名と配信 mime の規則は names.ts が持つ (docs/93-リファクタリング計画.md §4-2)。

import type { AudioFormat } from '../../audio/audioFormats'
import { containsMarker, startsWith } from './bytes'
import { findTopLevelBox, handlerTypesIn, readIsoBmffBrands } from './isoBmff'
import {
  EBML_MAGIC,
  WEBM_AUDIO_CODEC_IDS,
  WEBM_AUDIO_LEADS,
  WEBM_VIDEO_CODEC_IDS,
  WEBM_VIDEO_LEADS,
} from './webm'

// webm はブラウザ内録音の受け皿 (41-QR-search/docs/12「ノート内録音の実装計画」)。
// Chrome / Android の MediaRecorder は webm/opus しか出せないため、
// 録音をノートへ挿入するにはこの形式を受ける必要がある。
// 形式の一覧そのものは audio/audioFormats.ts が持つ (表示・OCR 除外と共有するため)
export type { AudioFormat }

const AUDIO_FORMAT_TO_MIME: Record<AudioFormat, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  webm: 'audio/webm',
}

// sniff で決めた形式を、保存に使う mime / ext へ写す (mp3/m4a/wav は形式名=拡張子)。
export function audioSaveInfo(format: AudioFormat): { mime: string; ext: string } {
  return { mime: AUDIO_FORMAT_TO_MIME[format], ext: format }
}

// WAV は RIFF コンテナ: "RIFF"(0) + "WAVE"(8)
function isWav(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    [0x57, 0x41, 0x56, 0x45].every((byte, i) => bytes[8 + i] === byte)
  )
}

// MP3: ID3v2 タグ ("ID3") で始まるか、生フレームの同期語で始まる。
// 同期語は 11bit すべて 1 = 先頭 0xFF かつ次バイトの上位 3bit が立っている。
// JPEG (FF D8 …) は次バイトの上位 3bit が 110 なので当たらない (画像と衝突しない)。
function isMp3(bytes: Uint8Array): boolean {
  if (startsWith(bytes, [0x49, 0x44, 0x33])) {
    return true
  }
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
}

// m4a を名乗る ISO-BMFF ブランド。動画 (mp42/isom 単独) を音声として受けない
// よう、音声専用の M4A / M4B だけを見る。iPhone のボイスメモ (.m4a) は major
// brand が "M4A " なのでこれで拾える。他ツール由来の mp42 単独 m4a は弾かれるが、
// 動画混入を防ぐことを優先する (41-QR-search/docs/12)。
const M4A_BRANDS = new Set(['M4A ', 'M4B '])

// moov のトラック構成が「音声のみ」か。ブランド名の列挙 (M4A_BRANDS) は
// 「どのブランドが来るか」の当てずっぽうになりがちで、Safari の MediaRecorder が
// 出す mp4 (iso5 系) はそこを通らない。トラックの種別で判定すればブランドに
// 依らず正しく、しかも映像トラックを持つ mp4 を確実に弾ける (41-QR-search/docs/12)。
function hasAudioOnlyTracks(bytes: Uint8Array): boolean {
  const moov = findTopLevelBox(bytes, 'moov')
  if (!moov) {
    return false
  }
  const handlers = handlerTypesIn(moov)
  return handlers.includes('soun') && !handlers.includes('vide')
}

function sniffIsoBmffAudio(bytes: Uint8Array): AudioFormat | null {
  const brands = readIsoBmffBrands(bytes)
  if (!brands) {
    return null
  }
  // ブランドが音声を名乗る (iPhone ボイスメモ) か、moov のトラックが音声だけ
  // (Safari の録音) なら音声として受ける
  if (brands.some((b) => M4A_BRANDS.has(b))) {
    return 'm4a'
  }
  return hasAudioOnlyTracks(bytes) ? 'm4a' : null
}

// 音声 CodecID を探す範囲。MediaRecorder の出力は Tracks をヘッダ側に置くので
// 数 KB あれば足りる (実測: Chrome は offset 220、Firefox は 202)。
// ここより後ろにしか音声 CodecID が無いものは安全側に倒して拒否する。
const WEBM_AUDIO_SCAN_BYTES = 64 * 1024

function isWebmAudio(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, EBML_MAGIC)) {
    return false
  }
  // 映像 CodecID は**ファイル全体**から探す。先頭だけ見ていると、EBML の
  // Void 要素で窓を埋めて映像トラックを走査範囲の外へ押し出せてしまう
  // (security-reviewer が PoC で実証済み: A_OPUS → 70KB の詰め物 → V_VP9)。
  // 音声側と違い、こちらは「見落とすと通してしまう」向きなので範囲を切らない。
  if (containsMarker(bytes, WEBM_VIDEO_CODEC_IDS, WEBM_VIDEO_LEADS, bytes.byteLength)) {
    return false
  }
  return containsMarker(
    bytes,
    WEBM_AUDIO_CODEC_IDS,
    WEBM_AUDIO_LEADS,
    WEBM_AUDIO_SCAN_BYTES,
  )
}

// 先頭バイトから音声形式を判定する。判定できなければ null (=非対応)。
// route.ts は画像判定 (sniffImageFormat) が外れたときにこれを試す。
export function sniffAudioFormat(bytes: Uint8Array): AudioFormat | null {
  if (isMp3(bytes)) {
    return 'mp3'
  }
  if (isWav(bytes)) {
    return 'wav'
  }
  if (isWebmAudio(bytes)) {
    return 'webm'
  }
  return sniffIsoBmffAudio(bytes)
}
