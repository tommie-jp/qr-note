// 編集フォームの中だけで使う DOM イベント (docs/87-編集競合対策計画.md §3-3)。
//
// 競合バナーは MemoEditor が持つが、揃え直したいものはフォームの中に
// 散らばっている (UnsavedGuard の比較基準・/edit の url と mode)。
// context を増やして親子を結び直すより、**フォームを土俵にした DOM イベント**
// のほうが結線が浅く済む — どちらも同じ form の子孫であることが唯一の前提。

import type { Mode } from '@/lib/validation'

// 本文をサーバ値へ揃え直した。UnsavedGuard が「保存済みの内容」を取り直す
export const MEMO_BASELINE_EVENT = 'qr:memo-baseline'

// 競合バナーの「サーバ版を読み込む」。/edit の url / mode も一緒に揃える
export const ADOPT_SERVER_EVENT = 'qr:adopt-server'

export interface AdoptServerDetail {
  url: string
  mode: Mode
}
