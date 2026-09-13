// --- webm (ブラウザ内録音, 41-QR-search/docs/12) ---
//
// webm/matroska は EBML マジックで判るが、**画像や PDF と違い音声と動画で
// 同じコンテナを使う**ため、マジックだけでは動画を弾けない。「動画を音声として
// 受けない」既存方針を保つため、Tracks 要素に現れる CodecID 文字列を見て
// 「音声があり映像が無い」ものだけを受ける。
//
// 音声 (sniff/audio.ts の isWebmAudio) と動画 (sniff/video.ts の isWebmVideo) が
// 同じ列挙を裏返しに使うので、マジックと CodecID の一覧はここに 1 つだけ置く
// (docs/93-リファクタリング計画.md §4-2)。

import { encodeAscii, leadByteTable } from './bytes'

export const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3]

export const WEBM_AUDIO_CODEC_IDS = ['A_OPUS', 'A_VORBIS'].map(encodeAscii)

// 映像 CodecID。1 つでもあれば動画とみなして拒否する。
export const WEBM_VIDEO_CODEC_IDS = [
  'V_VP8',
  'V_VP9',
  'V_AV1',
  'V_MPEG',
  'V_THEORA',
  'V_MS/',
].map(encodeAscii)

export const WEBM_AUDIO_LEADS = leadByteTable(WEBM_AUDIO_CODEC_IDS)
export const WEBM_VIDEO_LEADS = leadByteTable(WEBM_VIDEO_CODEC_IDS)
