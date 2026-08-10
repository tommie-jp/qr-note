// 画像記法 `![alt](src)` の src が指す添付の種別 (markdownPipeline.tsx から移設)。
//
// **クライアントからも読むためにここへ移した** (docs/70-編集ライブプレビュー計画.md
// §5)。移設前の置き場 (markdownPipeline.tsx) は Server Component 用の入れ物で、
// react-markdown・rehype-katex・remark 一式を抱えている。編集画面 (client) の
// 添付チップがそこから import すると、その一式が丸ごとブラウザへ降ってくる —
// 閲覧は Server Component なので、今はクライアントに 1 バイトも送っていない。
//
// 判定順そのものが仕様。特にシークレットを最初に見るのは安全の要で、下に
// 落ちると暗号文が割れた画像やチップの取得先として露出する。振り分け先の
// 部品 (プレイヤーにするかチップにするか) だけを消費側が持つ。

import { AUDIO_EXTENSION_ALTERNATION } from './audioFormats'
import { secretNameFromUrl } from './secrets'
import { TEXT_EXTENSION_ALTERNATION } from './textFormats'
import { VIDEO_EXTENSION_ALTERNATION } from './videoFormats'

// 音声の配信 URL (`/api/images/<uuid>.mp3` など)。エディタは音声を画像記法
// `![audio](url)` で挿入するので (docs/12-添付ファイル種類拡張メモ.md)、img の
// src が音声ならレンダラ側で <audio> 等に振り分ける。振り分け後の要素は
// sanitize 後に React が組み立てるので、生 HTML の許可リスト (sanitizeSchema)
// は要らない。
const AUDIO_SRC_RE = new RegExp(
  `\\.(?:${AUDIO_EXTENSION_ALTERNATION})(?:[?#]|$)`,
  'i',
)

// 動画の配信 URL (`/api/images/<uuid>.mp4` など)。エディタは動画を画像記法
// `![video](url)` で挿入するので (docs/14-動画挿入計画.md)、img の src が動画なら
// <video> に振り分ける。保存名の拡張子は mp4|mkv|mov で、音声の .webm とは
// 重ならない (webm 動画は .mkv で保存される。videoFormats.ts の経緯)。
const VIDEO_SRC_RE = new RegExp(
  `\\.(?:${VIDEO_EXTENSION_ALTERNATION})(?:[?#]|$)`,
  'i',
)

// PDF も同じく画像記法 `![ファイル名.pdf](url)` で本文に入る。インライン
// ビューアは埋め込まず、押したらブラウザ内蔵ビューアが開くリンクにする
// (iPhone との相性がよく、本文が重くならない)
const PDF_SRC_RE = /\.pdf(?:[?#]|$)/i

// テキスト系 (txt/csv/md) も同じ画像記法で入る。PDF と同じくページ内の
// ビューアで開く (docs/12-添付ファイル種類拡張メモ.md)
const TEXT_SRC_RE = new RegExp(
  `\\.(?:${TEXT_EXTENSION_ALTERNATION})(?:[?#]|$)`,
  'i',
)

export type ImgSrcKind =
  | { kind: 'secret'; name: string }
  | { kind: 'audio' | 'video' | 'pdf' | 'text' | 'image' }

export function classifyImgSrc(src: string): ImgSrcKind {
  const secretName = secretNameFromUrl(src)
  if (secretName !== null) {
    return { kind: 'secret', name: secretName }
  }
  if (AUDIO_SRC_RE.test(src)) {
    return { kind: 'audio' }
  }
  if (VIDEO_SRC_RE.test(src)) {
    return { kind: 'video' }
  }
  if (PDF_SRC_RE.test(src)) {
    return { kind: 'pdf' }
  }
  if (TEXT_SRC_RE.test(src)) {
    return { kind: 'text' }
  }
  return { kind: 'image' }
}
