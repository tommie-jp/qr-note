// 保存・配信・表示で使う動画の**拡張子**の唯一の出どころ
// (41-QR-search/docs/14-動画挿入計画.md)。audioFormats.ts と同じ役割で、この一覧は
// 保存名の検算 (isValidVideoName)・表示の振り分け (MarkdownView の
// VIDEO_SRC_RE)・挿入種別の判定 (editor/attachmentKinds.ts) で要る。足し忘れは例外に
// ならず黙って壊れる (その形式だけ <video> にならない) ので一覧はここ 1 つ。
//
// **これは「保存名の拡張子」であって「受け付ける入力形式」ではない。**
// 入力側 (ファイル選択のヒント・ペースト判定) は mp4/webm/mov を受けるが、
// webm 動画は保存時に `.mkv` へ写す — 音声のみの webm が既に `.webm` を
// 使っており (audioFormats)、**URL の拡張子だけで音声か動画かを一意に決める**
// 既存方針 (MarkdownView は同期描画で DB を引けない) を保つため。webm は
// Matroska の一種なので、映像トラックを持つものを `.mkv` と名乗らせるのは
// 妥当で、配信は Content-Type (video/webm) で行うため再生に影響はない。
//
// - mp4 … Safari/iOS の録画、一般的な動画 (音声は .m4a なので衝突しない)
// - mkv … webm 動画 (Chromium/Firefox の録画。中身は video/webm)
// - mov … iOS カメラロール由来 (QuickTime)

import { defineFormats } from './defineFormats'

const FORMATS = defineFormats(['mp4', 'mkv', 'mov'] as const)

export const VIDEO_EXTENSIONS = FORMATS.list

export type VideoExtension = (typeof VIDEO_EXTENSIONS)[number]

// 正規表現に埋める用の "mp4|mkv|mov" (defineFormats のコメントのとおりエスケープ不要)
export const VIDEO_EXTENSION_ALTERNATION = FORMATS.alternation
