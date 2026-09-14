// ライブプレビューの ON/OFF を端末に覚える (docs/70-編集ライブプレビュー計画.md §4)。
//
// **ノート単位ではなく端末単位**にする。記法を隠して読みたい人はどのノートでも
// 隠したいはずで、ノートごとに覚えると開くたびに表示が変わって落ち着かない。
//
// prefs/memoDraft.ts と同じ流儀で、Storage は引数で受ける純関数だけを置く
// (結線は components/editor/hooks/useLivePreview.ts と useEditorExtensions.ts 側)。読み書きの例外の扱いは prefs/storagePref.ts。

import 'client-only'
import { defineBooleanPref, type PrefStorage } from './storagePref'

export const LIVE_PREVIEW_STORAGE_KEY = 'qr-search:live-preview'

// **既定は ON**。日本語 IME での挙動を確かめてから切り替えた
// (デスクトップ Chromium は CDP の合成イベントで、iPhone は実機で。計画 §8)。
//
// 一度でも切り替えた端末は保存値が優先されるので、OFF にしてある端末が
// 勝手に ON へ戻ることはない (parseLivePreviewPref は '0' を尊重する)
export const LIVE_PREVIEW_DEFAULT = true

// プライベートモード等で読めない環境では既定で動く (設定は保険であって
// 本筋ではない。編集そのものは従来どおりできる)。書けなくてもその場の
// 切り替えは効いている (次に開くと既定に戻るだけ)
const LIVE_PREVIEW_PREF = defineBooleanPref(
  LIVE_PREVIEW_STORAGE_KEY,
  LIVE_PREVIEW_DEFAULT,
)

// 保存されていない・読めない・知らない値はすべて既定に倒す
// (localStorage は外部入力として扱う)
export function parseLivePreviewPref(raw: string | null): boolean {
  return LIVE_PREVIEW_PREF.parse(raw)
}

export function loadLivePreviewPref(
  storage: PrefStorage | null | undefined,
): boolean {
  return LIVE_PREVIEW_PREF.load(storage)
}

export function saveLivePreviewPref(
  storage: PrefStorage | null | undefined,
  enabled: boolean,
): void {
  LIVE_PREVIEW_PREF.save(storage, enabled)
}
